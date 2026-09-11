-- BC-7 · Avisos del borrado de cuenta + arreglo de notify_erasure_requested.
--
-- Solo funciones: ningun cambio de esquema, ningun dato. Los tres valores de
-- `notification_type` que consume esto (account_deletion_requested,
-- account_deletion_completed, tutor_unlinked) los dejo puestos BC-1.
--
--  1. `notify_erasure_requested` — ARREGLO. Avisaba a TODOS los admin_club y directores
--     del club, tambien a los dados de baja. Le faltaba `and m.left_at is null`.
--
--  2. `request_account_deletion` — avisa al CLUB (admin_club + directores ACTIVOS) de
--     cada club afectado, y al SUPERADMIN si quien se va es admin_club (decision 1c de
--     Jose: al admin no se le bloquea, se ESCALA).
--
--  3. `finalize_account_deletion` — al rematar: avisa al OTRO TUTOR de cada jugador
--     compartido, avisa al SUPERADMIN de que el club ya se ha quedado sin admin, y
--     CIERRA las asignaciones de team_staff.
--
-- Los avisos van DENTRO de las RPC y no en un trigger: la fila de
-- account_deletion_requests se inserta ANTES de calcular affected_membership_ids, asi
-- que un AFTER INSERT no sabria a que clubes avisar. Y las RPC son el punto comun por
-- el que pasan la web (Server Action) y la nativa (route handler).
--
-- CADA aviso lleva su PROPIO savepoint (BEGIN ... EXCEPTION WHEN OTHERS), no uno
-- compartido: si un aviso falla, los demas tienen que salir igual. Un aviso perdido es
-- leve; tumbar el borrado que ha pedido el titular, o revertir una anonimizacion ya
-- aplicada, no. Mismo criterio que trg_notify_erasure_requested.
--
-- NINGUN payload lleva el nombre de quien se borra. `notifications.payload` es
-- INMUTABLE por trigger (`notifications_protect_update`), asi que un nombre metido ahi
-- no se podria limpiar nunca: el aviso seria el ultimo sitio del sistema donde
-- sobreviviria el nombre de una cuenta borrada, contra ADR-0021. La novedad dice QUE
-- pasa y QUE equipos hay que cubrir; quien era se mira donde ya lo gobierna RLS: la
-- lista de miembros del club, donde aparece de baja con su `left_reason`. Es el mismo
-- criterio con el que D6 construyo `erasure_requested`.
--
-- Canal: solo `in_app`. Ni una fila de push, tambien como D6 — son novedades de
-- gestion, no algo que justifique despertar un telefono de madrugada.
--
-- Las tres definiciones se toman VERBATIM de produccion (pg_get_functiondef,
-- 2026-09-11; cuerpo identico al de sus migraciones) y solo se les insertan los bloques
-- nuevos. `create or replace`, no drop+create: conserva duenno y ACL.


-- ── 1 · ARREGLO: notify_erasure_requested no debe avisar a gente de baja ─────
CREATE OR REPLACE FUNCTION public.notify_erasure_requested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  begin
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      m.profile_id,
      'erasure_requested'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object('erasure_request_id', new.id, 'player_id', new.player_id),
      'erasure_requested:' || new.id::text || ':' || m.profile_id::text || ':in_app'
    from public.memberships m
    where m.club_id = new.club_id
      and m.role in ('admin_club', 'director')
      -- BC-7 — un admin o director DE BAJA no puede decidir una supresion y ya no
      -- deberia ver datos del club; seguia recibiendo el aviso desde D6.
      and m.left_at is null
      and m.profile_id <> new.requested_by
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      -- Best-effort: el aviso NUNCA puede tumbar la solicitud de supresión.
      raise warning 'notify_erasure_requested falló para erasure_requests.id=%: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;

comment on function public.notify_erasure_requested() is
  'D6 + BC-7 — emite novedad in_app (sin push) a admin_club+directores ACTIVOS del club cuando se crea una solicitud de supresion. Best-effort: los fallos se capturan y NO revierten la solicitud.';


-- ── 2 · request_account_deletion: aviso al club y escalado al superadmin ─────
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
      and not exists (
        select 1 from public.player_accounts pa2
        where pa2.player_id = pa.player_id and pa2.profile_id <> v_uid
      )
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

-- ── 3 · finalize_account_deletion: avisos del remate + cierre de team_staff ──
CREATE OR REPLACE FUNCTION public.finalize_account_deletion(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req    public.account_deletion_requests%rowtype;
  v_avatar text;
  v_email  text;
begin
  perform pg_advisory_xact_lock(hashtext('account_deletion:' || p_profile_id::text));

  select * into v_req
    from public.account_deletion_requests
   where profile_id = p_profile_id and status = 'pending'
   limit 1;

  -- Idempotente para el cron: si ya está completado (o cancelado), no hay nada que hacer.
  if not found then
    return null;
  end if;

  select avatar_url into v_avatar from public.profiles where id = p_profile_id;
  select email       into v_email  from auth.users     where id = p_profile_id;

  -- 5.1 · El perfil: fuera la PII, queda la fila (la sostienen 52 FK, ADR-0021).
  update public.profiles
     set full_name     = null,
         avatar_url    = null,
         phone         = null,
         date_of_birth = null,
         deleted_at    = now(),
         updated_at    = now()
   where id = p_profile_id;

  -- 5.2 · Contacto que gestiona el club (no es el login).
  update public.memberships
     set phone = null, contact_email = null
   where profile_id = p_profile_id;

  -- 5.3 · Invitaciones DIRIGIDAS a esta persona: el email es suyo. Las que ÉL envió a
  -- otros no se tocan (ese email es de un tercero). Las no aceptadas se invalidan.
  update public.invitations
     set email      = 'deleted-' || id::text || '@deleted.invalid',
         expires_at = least(expires_at, now())
   where accepted_at is null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  update public.invitations
     set email = 'deleted-' || id::text || '@deleted.invalid'
   where accepted_at is not null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  -- ── BC-7 · AVISOS DEL REMATE ───────────────────────────────────────────────
  -- Va ANTES de 5.4 porque `tutor_unlinked` necesita player_accounts INTACTO: despues
  -- del delete ya no se sabe de que jugadores era tutor.
  --
  -- Un SAVEPOINT POR AVISO (BEGIN...EXCEPTION separados), no uno para los dos: si uno
  -- falla, el otro tiene que salir igual. En el ensayo de esta migracion un solo bloque
  -- se llevo por delante los dos avisos de golpe.
  --
  -- Best-effort en cualquier caso: un aviso que falle NO puede revertir una
  -- anonimizacion ya aplicada (5.1 ya vacio el perfil). Mismo criterio que
  -- trg_notify_erasure_requested.
  begin
    -- 1) OTRO TUTOR del mismo jugador. Se avisa al COMPLETAR y no al solicitar: hasta
    --    aqui el borrado era cancelable, y decirle a alguien "el otro tutor se va" por
    --    algo que puede no ocurrir es filtrar una intencion ajena. Ahora es un hecho, y
    --    ademas es accionable: pasa a ser el unico tutor del menor.
    --    Solo salen los jugadores que TIENEN otro tutor; de los que era unico tutor no
    --    hay a quien avisar (esos van por la via de erasure_requests).
    --    El nombre del MENOR si viaja: el destinatario es su propio tutor.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      other.profile_id,
      'tutor_unlinked'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'player_id', p.id,
        'player_first_name', p.first_name,
        'club_id', p.club_id
      ),
      'tutor_unlinked:' || v_req.id::text || ':' || p.id::text
        || ':' || other.profile_id::text || ':in_app'
    from public.player_accounts mine
    join public.players p on p.id = mine.player_id
    join public.player_accounts other
      on other.player_id = mine.player_id and other.profile_id <> p_profile_id
    where mine.profile_id = p_profile_id
      and p.erased_at is null
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: tutor_unlinked fallo para %: %', p_profile_id, sqlerrm;
  end;

  begin
    -- 2) SUPERADMIN, por cada club donde era admin_club. Es el momento en que el club
    --    se queda sin admin de verdad: la membership lleva de baja desde la solicitud y
    --    5.5 esta a punto de soltar clubs.owner_profile_id. El aviso de la SOLICITUD
    --    daba 30 dias de margen; este dice que se acabaron.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      pa.profile_id,
      'account_deletion_completed'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'deletion_id', v_req.id,
        'club_id', m.club_id,
        'club_name', c.name,
        'role', 'admin_club',
        'is_platform', true
      ),
      'account_deletion_completed:' || v_req.id::text || ':' || m.club_id::text
        || ':' || pa.profile_id::text || ':in_app'
    from public.memberships m
    join public.clubs c on c.id = m.club_id
    cross join public.platform_admins pa
    where m.profile_id = p_profile_id
      and m.role = 'admin_club'
      and pa.profile_id <> p_profile_id
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: account_deletion_completed fallo para %: %', p_profile_id, sqlerrm;
  end;

  -- BC-7 · Las asignaciones de equipo se CIERRAN aqui, no al solicitar.
  -- `request_account_deletion` pone left_at en memberships con un UPDATE directo, sin
  -- pasar por `set_membership_left`, que es quien cierra team_staff en una baja normal
  -- — asi que hasta ahora el equipo seguia listando como entrenador ACTIVO a alguien
  -- que se habia ido. Cerrarlo en la SOLICITUD seria peor: el borrado es cancelable y
  -- `set_membership_left` no reabre team_staff al reactivar (migracion
  -- 20261053000000), o sea que arrepentirse dejaria al entrenador sin sus equipos.
  -- Aqui ya no hay vuelta atras. Esto NO es un aviso: va fuera del best-effort, porque
  -- es parte del borrado y tiene que ser atomico con el.
  -- `greatest` protege el CHECK team_staff_check (left_at >= joined_at).
  update public.team_staff ts
     set left_at = greatest(current_date, ts.joined_at)
    from public.memberships m
   where m.id = ts.membership_id
     and m.profile_id = p_profile_id
     and ts.left_at is null;

  -- 5.4 · Vínculos y canales: se borran de verdad.
  delete from public.player_accounts          where profile_id = p_profile_id;
  delete from public.team_follows             where profile_id = p_profile_id;
  delete from public.player_spectators        where spectator_profile_id = p_profile_id;
  delete from public.team_chat_participation  where profile_id = p_profile_id;
  delete from public.team_conversation_reads  where profile_id = p_profile_id;
  delete from public.staff_conversation_reads where profile_id = p_profile_id;
  delete from public.expo_push_tokens         where user_id = p_profile_id;
  delete from public.push_subscriptions       where user_id = p_profile_id;
  delete from public.notification_preferences where user_id = p_profile_id;
  delete from public.notifications            where user_id = p_profile_id;

  -- 5.5 · Si era el dueño de un club, se libera el hueco. `assign_club_owner_on_admin`
  -- solo escribe cuando owner_profile_id es NULL, así que sin esto el admin_club nuevo
  -- que designe la plataforma nunca pasaría a ser owner.
  update public.clubs set owner_profile_id = null where owner_profile_id = p_profile_id;

  -- 5.6 · Las supresiones de menor que sigan pendientes SE QUEDAN pendientes: el dato
  -- del menor tiene otro responsable (el club) y otro plazo. Solo cambia que quien las
  -- pidió aparecerá ya como "Usuario eliminado".

  update public.account_deletion_requests
     set status = 'completed', completed_at = now()
   where id = v_req.id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select p_profile_id, 'account.deleted', 'profile', p_profile_id, m.club_id,
         'Cuenta anonimizada: fin del proceso de borrado'
    from public.memberships m
   where m.profile_id = p_profile_id;

  return v_avatar;  -- ruta del objeto a borrar por Storage API (NULL si no había)
end;
$function$;
