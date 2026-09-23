-- ════════════════════════════════════════════════════════════════════════════
-- RC-4 · El tutor no borra su cuenta mientras su hijo tenga la suya.
--
-- La segunda regla de Jose, y la ÚLTIMA de la serie. Va la última a propósito: el
-- 20261100000000 le dio al tutor la llave (retirar la cuenta del hijo él mismo) y el
-- #699 puso el aviso en la pantalla. Solo con las dos cosas desplegadas este candado
-- es una puerta con salida y no una trampa — «nadie depende de un tercero para poder
-- irse» es la decisión 1 de Jose, escrita en BC-2, y es el suelo del 5.1.1(v) de Apple.
--
-- ── QUÉ PASABA HASTA AHORA, MEDIDO ──────────────────────────────────────────
-- Nada lo impedía. BC-1 crea una solicitud de supresión por cada jugador del que sea
-- único tutor, pero eso no BLOQUEA: `account_deletions_due` remata a los 30 días
-- «apruebe, rechace o ignore el club». Ensayo contra producción con el tutor real de
-- un niño de cinco años con cuenta propia, forzando el vencimiento del plazo:
--
--     tutores: 0   ·   cuenta_propia: 1   ·   membresía activa del menor: 1
--
-- El menor se quedaba dentro de la app, con su cuenta, sin nadie. Es la decisión que
-- quedó abierta en la 20261097000000, cuyo trigger exceptúa esta vía a propósito
-- (anclada en `profiles.deleted_at`) para no romper el borrado de cuenta.
--
-- ── EL PREDICADO, EN UN SOLO SITIO ──────────────────────────────────────────
-- `account_deletion_holds()` responde QUIÉNES impiden el borrado, y lo llaman los dos:
-- la pantalla (para avisar antes de pulsar) y el `raise` de aquí abajo. Es la lección
-- de MN-BC y de BC-3, que ya costó una serie cada una: el predicado copiado en dos
-- sitios acaba diciendo dos cosas, y entonces la pantalla promete una cosa y la acción
-- hace otra.
--
-- Y se construye sobre las funciones que YA responden esas preguntas, en vez de
-- reescribirlas: `preview_account_deletion()` dice de quién es ÚNICO tutor (desde
-- MN-BC, «otro TUTOR» y no «otra cuenta»: la fila `self` del hijo no vale como
-- relevo) y `player_self_account_status()` dice si ese hijo entra o está a punto.
--
-- ── EL FILTRO QUE NO ES OBVIO: `player_is_minor` ────────────────────────────
-- `preview_account_deletion` NO filtra por relación, así que un jugador ADULTO con su
-- propia cuenta y sin ningún tutor sale en su PROPIO preview. Medido en producción
-- (ensayo con ROLLBACK, jugador nacido en 1995, solo fila `self`):
--
--     jugador: Adulto · estado: linked
--
-- Sin este filtro, ese jugador se bloquearía a SÍ MISMO y no podría borrar nunca su
-- cuenta. Eso no es un detalle de producto: es exactamente lo que el 5.1.1(v) de Apple
-- prohíbe. Hoy no hay ninguno —medido: las 2 filas `self` de producción son de
-- menores—, pero la 20261038 existe justamente para permitirlo.
--
-- ⚠️ EL CLIENTE DEL #699 TIENE ESE MISMO FALLO y se corrige en el PR siguiente, que es
-- código y por tanto va aparte. Hasta entonces la pantalla marcaría a ese jugador
-- adulto aunque esta función ya no lo cuente. No es alcanzable con los datos de hoy.
--
-- ── EL CASO DEL MENOR QUE SE BORRA SU PROPIA CUENTA NO NECESITA CLÁUSULA ────
-- Un menor con fila `self` tiene SIEMPRE un tutor: lo garantiza el trigger de la
-- 20261097000000. Así que `player_has_other_tutor` es cierto para él y nunca llega al
-- preview. Queda dicho aquí porque la próxima persona que lea esto va a preguntárselo.
--
-- ── DÓNDE VA EL `raise` Y POR QUÉ AHÍ ───────────────────────────────────────
-- DESPUÉS de la comprobación de idempotencia. Si ya hay un borrado en curso se
-- devuelve tal cual, como siempre: quien está en la pantalla terminal solo puede
-- cancelar, y hacerle fallar una llamada que antes le funcionaba no le da ninguna
-- salida nueva. Y ANTES del INSERT, que es la primera escritura: el rechazo no deja
-- rastro.
--
-- El cuerpo se reproduce desde su definición VIVA (`pg_get_functiondef`); el diff
-- contra ella es EXACTAMENTE ese bloque.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- `preview_account_deletion` se queda como está: su trabajo —de quién se pedirá la
-- supresión al club— no ha cambiado. Y la ventana que este candado NO cierra está
-- escrita al final del fichero, sin disimularla.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. QUIÉNES impiden el borrado
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.account_deletion_holds()
returns table (
  hold_player_id uuid,
  first_name     text,
  last_name      text,
  club_id        uuid,
  club_name      text,
  estado         text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pv.player_id, pv.first_name, pv.last_name, pv.club_id, pv.club_name, e.estado
    from public.preview_account_deletion() pv
    cross join lateral (
      select public.player_self_account_status(pv.player_id) as estado
    ) e
   where public.player_is_minor(pv.player_id)
     and e.estado in ('linked', 'invited')
   order by pv.first_name, pv.last_name;
$$;

comment on function public.account_deletion_holds() is
  'RC-4: los hijos que IMPIDEN que esta persona borre su cuenta — menores de los que es UNICO tutor y que ya entran con su propia cuenta (linked) o tienen una invitacion viva (invited). Lo llaman la pantalla y el raise de request_account_deletion, para que no puedan discrepar. Filtra por player_is_minor porque preview_account_deletion no mira la relacion: sin eso, un jugador adulto con su propia cuenta se bloquearia a si mismo.';

-- ACL. Los privilegios por defecto de Supabase se conceden POR NOMBRE a anon y a
-- authenticated: revocar de PUBLIC no basta, hay que nombrarlos.
revoke all on function public.account_deletion_holds() from public;
revoke all on function public.account_deletion_holds() from anon;
revoke all on function public.account_deletion_holds() from authenticated;
grant execute on function public.account_deletion_holds() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El candado, en la RPC que crea la solicitud
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- ── RC-4 · EL CANDADO ──────────────────────────────────────────────────────
  -- Primero retira la cuenta de su hijo —puede hacerlo él solo, `revoke_player_self_account`
  -- (20261100000000)— y entonces puede irse. El QUIÉNES lo responde el mismo
  -- `account_deletion_holds()` que lee la pantalla, para que no puedan discrepar.
  --
  -- Va DESPUÉS de la idempotencia (a quien ya está en la pantalla terminal no se le
  -- rompe una llamada que antes le funcionaba) y ANTES del INSERT, que es la primera
  -- escritura: el rechazo no deja rastro.
  if exists (select 1 from public.account_deletion_holds()) then
    raise exception 'hijo_con_cuenta_propia'
      using hint = 'Tienes hijos menores que entran con su propia cuenta y eres su '
                   'unico tutor. Retirales el acceso antes de eliminar la tuya.';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE ESTE CANDADO NO CIERRA, dicho para que no se lea de más
-- ─────────────────────────────────────────────────────────────────────────────
-- Se mide AL PEDIR el borrado, no al rematarlo. Si durante los 30 días el tutor
-- invitase a su hijo a tener cuenta propia y el hijo la aceptara, el remate seguiría
-- adelante y el menor volvería a quedarse sin tutor. Es estrecho —el tutor está en la
-- pantalla terminal, que solo ofrece cancelar— pero la RPC de invitar sigue expuesta y
-- no mira si hay un borrado en curso.
--
-- No se tapa aquí a propósito: el arreglo natural es que `finalize_account_deletion`
-- retire esas cuentas antes de anonimizar —hacer lo que el tutor tenía que haber
-- hecho— y eso toca el motor del borrado, que es otra pieza y merece su propio PR y su
-- propia decisión. Queda anotado, no resuelto.
