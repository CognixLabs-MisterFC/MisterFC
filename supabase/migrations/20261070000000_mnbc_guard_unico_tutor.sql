-- ════════════════════════════════════════════════════════════════════════════
-- MN-BC · La fila `self` desarmaba el guard del único tutor, en silencio.
--
-- EL HALLAZGO. BC-1 impide que un tutor se borre dejando huérfano a un jugador: por cada
-- jugador activo del que sea ÚNICO tutor crea una solicitud de supresión, y esa solicitud
-- bloquea el borrado hasta que el club la decida. Es la regla de Jose: el tutor no puede
-- irse si deja a un menor sin nadie.
--
-- Pero «único tutor» se detecta así:
--
--     not exists (
--       select 1 from public.player_accounts pa2
--       where pa2.player_id = pa.player_id and pa2.profile_id <> v_uid
--     )
--
-- **No mira `relation`: cuenta CUALQUIER otra cuenta vinculada.** En cuanto el menor
-- tenga su propia fila `relation='self'` (MN-2), el tutor deja de ser «único tutor» a
-- ojos de BC: hay otra cuenta enlazada. Resultado — el tutor borra su cuenta, BC no crea
-- la solicitud, nada bloquea nada, y el menor se queda con cuenta propia y sin ningún
-- tutor. Exactamente el estado que la regla prohíbe.
--
-- No falla ruidosamente: deja de proteger. Por eso va ANTES de que la cuenta del menor
-- se pueda estrenar de verdad.
--
-- ── EL ARREGLO, EN EL PUNTO COMÚN ───────────────────────────────────────────
-- El predicado estaba copiado en DOS sitios —`preview_account_deletion`, que pinta los
-- bloqueos antes de confirmar, y `request_account_deletion`, que los crea—. Si solo se
-- arreglara uno, la pantalla diría una cosa y el borrado haría otra. Así que la pregunta
-- se muda a un helper y las dos lo llaman: lección de BC-3 otra vez.
--
-- Los dos cuerpos se reproducen desde su definición VIVA (`pg_get_functiondef`); lo único
-- que cambia en cada uno es ese predicado.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- `finalize_account_deletion` también une `player_accounts` por `profile_id <> ...`, pero
-- ahí NO es un guard: es el reparto del aviso `tutor_unlinked` a las demás cuentas del
-- jugador. Que al hijo con cuenta propia le llegue que su tutor se ha ido no es un fallo,
-- es información que le concierne. Se queda.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EL HELPER — la pregunta, en un solo sitio
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_has_other_tutor(p_player_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.player_accounts pa
    where pa.player_id = p_player_id
      and pa.profile_id is distinct from p_profile_id
      and pa.relation in ('parent', 'guardian')
  );
$$;

comment on function public.player_has_other_tutor(uuid, uuid) is
  'MN-BC: ¿le queda al jugador ALGÚN OTRO tutor (parent/guardian) aparte de este perfil? La cuenta propia del hijo (relation=self) NO cuenta como relevo: un menor no se tutela a si mismo. Base del guard de unico tutor de BC-1.';

revoke all on function public.player_has_other_tutor(uuid, uuid) from public;
grant execute on function public.player_has_other_tutor(uuid, uuid) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LOS DOS LLAMANTES
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 · preview: lo que se le enseña al usuario ANTES de confirmar.
CREATE OR REPLACE FUNCTION public.preview_account_deletion()
 RETURNS TABLE(player_id uuid, first_name text, last_name text, club_id uuid, club_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, p.first_name, p.last_name, p.club_id, c.name
  from public.player_accounts pa
  join public.players p on p.id = pa.player_id
  join public.clubs   c on c.id = p.club_id
  where pa.profile_id = (select auth.uid())
    and (select auth.uid()) is not null
    and p.erased_at is null
    and p.left_club_at is null
    -- MN-BC: «otro TUTOR», no «otra cuenta». La fila `self` del hijo no vale como
    -- relevo: si contara, el tutor podria borrarse dejando al menor sin nadie.
    and not public.player_has_other_tutor(pa.player_id, (select auth.uid()))
  order by p.first_name, p.last_name;
$function$;

-- 2.2 · request: lo que de verdad crea los bloqueos.
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, blocking_players integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_existing  uuid;
  v_req       uuid;
  v_members   uuid[];
  v_blockers  integer := 0;
  v_player    record;
  v_er_id     uuid;
  v_deadline  timestamptz;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  perform pg_advisory_xact_lock(hashtext('account_deletion:' || v_uid::text));

  -- Idempotente: si ya hay una pendiente se devuelve tal cual, sin duplicar nada.
  select id into v_existing
    from public.account_deletion_requests
   where profile_id = v_uid and status = 'pending'
   limit 1;
  if v_existing is not null then
    return query
      select v_existing,
             (select count(*)::integer from public.erasure_requests er
               where er.account_deletion_id = v_existing and er.status = 'pending');
    return;
  end if;

  insert into public.account_deletion_requests (profile_id, deadline_at, reason)
  values (v_uid, now() + interval '30 days', nullif(btrim(p_reason), ''))
  returning id, deadline_at into v_req, v_deadline;

  -- Corte de acceso INMEDIATO. Se guardan las memberships tocadas para que cancelar
  -- revierta exactamente estas y no una baja anterior del club.
  with upd as (
    update public.memberships
       set left_at     = current_date,
           left_reason = 'Baja automatica por borrado de cuenta solicitado por el usuario'
     where profile_id = v_uid
       and left_at is null
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_members from upd;

  update public.account_deletion_requests
     set affected_membership_ids = v_members
   where id = v_req;

  -- Una solicitud de supresión por cada jugador activo del que sea ÚNICO tutor.
  for v_player in
    select p.id as player_id, p.club_id
    from public.player_accounts pa
    join public.players p on p.id = pa.player_id
    where pa.profile_id = v_uid
      and p.erased_at is null
      and p.left_club_at is null
      -- MN-BC: «otro TUTOR», no «otra cuenta». Ver player_has_other_tutor.
      and not public.player_has_other_tutor(pa.player_id, v_uid)
  loop
    perform pg_advisory_xact_lock(hashtext('erasure_req:' || v_player.player_id::text));

    -- Si el tutor ya había pedido la supresión por su cuenta, se ENLAZA en vez de
    -- insertar: el índice parcial `erasure_requests_one_pending` solo admite una.
    select id into v_er_id
      from public.erasure_requests
     where player_id = v_player.player_id and status = 'pending'
     limit 1;

    if v_er_id is not null then
      -- PREEXISTENTE: el tutor ya la había pedido por su cuenta. Se ENLAZA porque
      -- también bloquea el borrado, pero `created_by_account_deletion` queda en false:
      -- es independiente y sobrevive si el usuario cancela.
      update public.erasure_requests
         set account_deletion_id = v_req
       where id = v_er_id;
    else
      insert into public.erasure_requests (
        player_id, club_id, requested_by, reason,
        account_deletion_id, created_by_account_deletion
      ) values (
        v_player.player_id, v_player.club_id, v_uid,
        'Solicitud generada al pedir el borrado de la cuenta del unico tutor',
        v_req, true
      );
      -- El aviso al club lo dispara `trg_notify_erasure_requested` (AFTER INSERT).
    end if;

    v_blockers := v_blockers + 1;
  end loop;

  -- Canales de aviso: fuera YA. Seguir notificando a quien ha pedido irse no es
  -- aceptable, y el token de dispositivo es en sí mismo un identificador.
  delete from public.expo_push_tokens        where user_id = v_uid;
  delete from public.push_subscriptions      where user_id = v_uid;
  delete from public.notification_preferences where user_id = v_uid;
  delete from public.notifications           where user_id = v_uid;

  -- ── BC-7 · AVISO AL CLUB (y al superadmin si se va un admin_club) ──────────
  -- Va DENTRO de la RPC porque es el punto comun: la web (Server Action) y la nativa
  -- (route handler) acaban las dos aqui. Un trigger AFTER INSERT no valdria: la fila
  -- de account_deletion_requests se inserta ANTES de calcular affected_membership_ids,
  -- asi que el trigger no sabria a que clubes avisar.
  --
  -- SIN NOMBRE en el payload, a proposito. Mismo criterio que `erasure_requested`
  -- (D6): la novedad dice QUE ha pasado y que hay que cubrir; el dato personal vive
  -- donde ya esta gobernado por RLS — la persona aparece de baja en la lista de
  -- miembros del club, con `left_reason` explicando por que. Si el nombre viajara aqui,
  -- este payload seria el ultimo sitio del sistema donde sobreviviria el nombre de una
  -- cuenta borrada, y `notifications.payload` es INMUTABLE por trigger
  -- (`notifications_protect_update`): no habria forma de limpiarlo despues.
  -- `profile_id` si viaja: es un id para trazabilidad, no se pinta.
  --
  -- Los EQUIPOS si van, y son lo importante del aviso: no son dato personal y son lo
  -- que el club tiene que cubrir. Se leen aqui porque team_staff sigue abierto (solo
  -- se cierra al COMPLETAR: el borrado es cancelable).
  --
  -- La clave de dedupe lleva el CLUB: un director que este en dos de los clubes de
  -- esta persona tiene que recibir un aviso por cada uno, no uno solo.
  --
  -- SAVEPOINT POR BLOQUE, no uno para los dos: si el aviso al club falla, el escalado
  -- al superadmin tiene que salir igual. Un unico BEGIN...EXCEPTION los tumbaria a la
  -- vez, que es exactamente lo que paso en el ensayo de esta migracion.
  begin
    -- 1) admin_club + directores ACTIVOS de cada club afectado. `left_at is null`:
    --    un directivo de baja no tiene que enterarse de esto (mismo criterio que el
    --    arreglo de notify_erasure_requested en esta misma migracion).
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      d.profile_id,
      'account_deletion_requested'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'deletion_id', v_req,
        'profile_id',  v_uid,
        'club_id',     mine.club_id,
        'role',        mine.role,
        'deadline_at', v_deadline,
        'blocking_players', v_blockers,
        'teams', coalesce((
          select jsonb_agg(t.name order by t.name)
          from public.team_staff ts
          join public.teams t on t.id = ts.team_id
          where ts.membership_id = mine.id and ts.left_at is null
        ), '[]'::jsonb)
      ),
      'account_deletion_requested:' || v_req::text || ':' || mine.club_id::text
        || ':' || d.profile_id::text || ':in_app'
    from public.memberships mine
    join public.memberships d
      on d.club_id = mine.club_id
     and d.role in ('admin_club', 'director')
     and d.left_at is null
     and d.profile_id <> v_uid
    where mine.id = any(v_members)
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: aviso al club fallo para %: %', v_req, sqlerrm;
  end;

  begin
    -- 2) Superadmin de plataforma, por cada club donde era admin_club: decision 1c de
    --    Jose (al admin no se le bloquea, se ESCALA). Sin esto el club se queda sin
    --    admin y nadie de plataforma se entera hasta que alguien lo reporta.
    --
    --    La clave de dedupe es LA MISMA que la del bloque 1 a proposito: un superadmin
    --    que ademas sea admin o director de ese club ya recibio su aviso arriba y el
    --    `on conflict` lo salta, en vez de duplicarle la novedad.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      pa.profile_id,
      'account_deletion_requested'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'deletion_id', v_req,
        'profile_id',  v_uid,
        'club_id',     mine.club_id,
        'club_name',   c.name,
        'role',        'admin_club',
        'deadline_at', v_deadline,
        'is_platform', true
      ),
      'account_deletion_requested:' || v_req::text || ':' || mine.club_id::text
        || ':' || pa.profile_id::text || ':in_app'
    from public.memberships mine
    join public.clubs c on c.id = mine.club_id
    cross join public.platform_admins pa
    where mine.id = any(v_members)
      and mine.role = 'admin_club'
      and pa.profile_id <> v_uid
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: escalado al superadmin fallo para %: %', v_req, sqlerrm;
  end;

  -- Auditoría: una fila por club (audit_log.club_id es NOT NULL). Un usuario sin
  -- ningún club no deja fila; su rastro es la propia account_deletion_requests.
  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select v_uid, 'account.deletion_requested', 'profile', v_uid, m.club_id,
         'Borrado de cuenta solicitado por el propio usuario'
    from public.memberships m
   where m.id = any(v_members);

  return query select v_req, v_blockers;
end;
$function$;
