-- BC-1 · MOTOR del borrado de cuenta. Hermana de 20261058000000 (modelo).
--
-- Cinco RPC:
--   · preview_account_deletion()      — qué te va a bloquear (sin efectos).
--   · request_account_deletion()      — pide el borrado. Corta el acceso YA.
--   · cancel_account_deletion()       — arrepentimiento, en cualquier momento.
--   · my_account_deletion_status()    — estado propio, para la pantalla terminal.
--   · finalize_account_deletion()     — anonimiza. SOLO servidor (service_role).
--   · account_deletions_due()         — cola del cron. SOLO servidor.
--
-- Lo que esta migración NO hace, a propósito:
--   · NO toca `auth.users`. La neutralización (email no enrutable, contraseña aleatoria,
--     ban) es Admin API desde el route handler (BC-3): SQL no puede hablar con GoTrue.
--   · NO borra el objeto del avatar en Storage: `finalize` DEVUELVE la ruta y el server
--     action la borra por Storage API (mismo patrón que `decide_player_erasure`, porque
--     `storage.protect_delete` impide el DELETE por SQL).
--   · NO emite las notificaciones nuevas (`account_deletion_requested`, `tutor_unlinked`,
--     `account_deletion_completed`): eso es BC-7, sobre tipos ya regenerados. El aviso al
--     club al SOLICITAR ya sale gratis: el trigger vivo `trg_notify_erasure_requested`
--     dispara con cada `erasure_requests` que insertamos aquí.
--   · NO toca `consents` (decisión de Jose: ni `ip` ni `user_agent`).
--   · NO toca los cuerpos de mensajes ni la autoría del histórico deportivo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. preview_account_deletion — jugadores ACTIVOS de los que el usuario es el ÚNICO
--    tutor. Son los que van a generar una solicitud de supresión. Sin efectos.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.preview_account_deletion()
returns table (
  player_id   uuid,
  first_name  text,
  last_name   text,
  club_id     uuid,
  club_name   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.first_name, p.last_name, p.club_id, c.name
  from public.player_accounts pa
  join public.players p on p.id = pa.player_id
  join public.clubs   c on c.id = p.club_id
  where pa.profile_id = (select auth.uid())
    and (select auth.uid()) is not null
    and p.erased_at is null
    and p.left_club_at is null
    and not exists (
      select 1 from public.player_accounts pa2
      where pa2.player_id = pa.player_id
        and pa2.profile_id <> (select auth.uid())
    )
  order by p.first_name, p.last_name;
$$;

comment on function public.preview_account_deletion() is
  'BC-1 — jugadores activos (erased_at y left_club_at nulos) de los que el usuario actual es el ÚNICO tutor. Alimenta la pantalla de confirmación: son los que generarán una solicitud de supresión. auth.uid() cableado; sin efectos.';

revoke all on function public.preview_account_deletion() from public;
grant execute on function public.preview_account_deletion() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. request_account_deletion — UNA pulsación.
--
--    Efecto inmediato y sin depender de nadie: baja en todos sus clubes (el acceso
--    cae por los helpers de 20261050), fuera los canales de aviso, y una solicitud de
--    supresión por cada jugador del que sea único tutor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.request_account_deletion(p_reason text default null)
returns table (request_id uuid, blocking_players integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_existing  uuid;
  v_req       uuid;
  v_members   uuid[];
  v_blockers  integer := 0;
  v_player    record;
  v_er_id     uuid;
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
  returning id into v_req;

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
      update public.erasure_requests
         set account_deletion_id = v_req
       where id = v_er_id;
    else
      insert into public.erasure_requests (
        player_id, club_id, requested_by, reason, account_deletion_id
      ) values (
        v_player.player_id, v_player.club_id, v_uid,
        'Solicitud generada al pedir el borrado de la cuenta del unico tutor', v_req
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

  -- Auditoría: una fila por club (audit_log.club_id es NOT NULL). Un usuario sin
  -- ningún club no deja fila; su rastro es la propia account_deletion_requests.
  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select v_uid, 'account.deletion_requested', 'profile', v_uid, m.club_id,
         'Borrado de cuenta solicitado por el propio usuario'
    from public.memberships m
   where m.id = any(v_members);

  return query select v_req, v_blockers;
end;
$$;

comment on function public.request_account_deletion(text) is
  'BC-1 — el usuario pide el borrado de SU cuenta. Idempotente. Efecto inmediato: baja en todos sus clubes, borra push/preferencias/notificaciones y crea una solicitud de supresion por cada jugador activo del que sea unico tutor. NO toca auth.users ni anonimiza: eso es finalize_account_deletion desde el servidor.';

revoke all on function public.request_account_deletion(text) from public;
grant execute on function public.request_account_deletion(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. cancel_account_deletion — arrepentimiento, en cualquier momento hasta que el
--    job ejecute el borrado (decisión de Jose: sin ventana más corta).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.account_deletion_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  perform pg_advisory_xact_lock(hashtext('account_deletion:' || v_uid::text));

  select * into v_req
    from public.account_deletion_requests
   where profile_id = v_uid and status = 'pending'
   limit 1;
  if not found then
    raise exception 'not_pending';
  end if;

  -- Solo las memberships que ESTA solicitud puso de baja.
  -- Si mientras tanto el club recibió un admin_club nuevo, reactivar el viejo choca
  -- con `memberships_one_admin_per_club`. Se traduce a un error legible: la cuenta
  -- sigue en borrado y el usuario tiene que hablar con el club.
  begin
    update public.memberships
       set left_at = null, left_reason = null
     where id = any(v_req.affected_membership_ids);
  exception when unique_violation then
    raise exception 'admin_slot_taken';
  end;

  -- Las supresiones que nacieron de este borrado se retiran. Las que el tutor hubiera
  -- pedido por su cuenta ANTES también se enlazaron, así que también se retiran: el
  -- usuario recupera el estado previo completo y puede volver a pedirlas si quiere.
  update public.erasure_requests
     set status = 'cancelled', decided_at = now()
   where account_deletion_id = v_req.id
     and status = 'pending';

  update public.account_deletion_requests
     set status = 'cancelled', cancelled_at = now()
   where id = v_req.id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select v_uid, 'account.deletion_cancelled', 'profile', v_uid, m.club_id,
         'El usuario cancelo el borrado de su cuenta'
    from public.memberships m
   where m.id = any(v_req.affected_membership_ids);
end;
$$;

comment on function public.cancel_account_deletion() is
  'BC-1 — el usuario retira su solicitud de borrado. Reactiva EXACTAMENTE las memberships que la solicitud puso de baja (nunca una baja anterior del club) y cancela las supresiones que nacieron de ella. Error admin_slot_taken si el club ya tiene otro admin_club activo.';

revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. my_account_deletion_status — la pantalla terminal. auth.uid() CABLEADO.
--    Mismo idiom que `my_removed_memberships`: el usuario ya no tiene acceso RLS a
--    nada de su club, así que la lectura tiene que ser definer.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_account_deletion_status()
returns table (
  request_id      uuid,
  requested_at    timestamptz,
  deadline_at     timestamptz,
  pending_players integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.requested_at, r.deadline_at,
         (select count(*)::integer from public.erasure_requests er
           where er.account_deletion_id = r.id and er.status = 'pending')
  from public.account_deletion_requests r
  where r.profile_id = (select auth.uid())
    and (select auth.uid()) is not null
    and r.status = 'pending';
$$;

comment on function public.my_account_deletion_status() is
  'BC-1 — estado del borrado en curso del usuario ACTUAL (auth.uid() cableado, nunca el de otro). Cero filas si no hay borrado pendiente. Alimenta la pantalla terminal y el boton de cancelar.';

revoke all on function public.my_account_deletion_status() from public;
grant execute on function public.my_account_deletion_status() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. finalize_account_deletion — LA ANONIMIZACIÓN. Solo servidor.
--
--    Devuelve la ruta del avatar para que el llamante borre el objeto por Storage API
--    y después neutralice `auth.users` con la Admin API. En ese orden: lo irreversible
--    de GoTrue, lo ÚLTIMO.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.finalize_account_deletion(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.finalize_account_deletion(uuid) is
  'BC-1 — ANONIMIZA la cuenta (ADR-0021): vacia la PII de profiles y marca deleted_at, limpia contacto de memberships e invitaciones, borra vinculos y canales, libera clubs.owner_profile_id. NO toca auth.users (Admin API, BC-3), ni consents, ni los cuerpos de mensajes, ni el historico deportivo. Devuelve la ruta del avatar para borrarlo por Storage API. Idempotente. SOLO service_role.';

revoke all on function public.finalize_account_deletion(uuid) from public;
revoke all on function public.finalize_account_deletion(uuid) from authenticated, anon;
grant execute on function public.finalize_account_deletion(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. account_deletions_due — la cola del servidor. Dos motivos para completar:
--    (a) ya no quedan supresiones pendientes (el club decidió, apruebe o rechace);
--    (b) se cumplió el plazo de 30 días. Lo que llegue antes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.account_deletions_due()
returns table (request_id uuid, profile_id uuid, due_reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.profile_id,
         case when r.deadline_at <= now() then 'deadline' else 'resolved' end
  from public.account_deletion_requests r
  where r.status = 'pending'
    and (
      r.deadline_at <= now()
      or not exists (
        select 1 from public.erasure_requests er
        where er.account_deletion_id = r.id and er.status = 'pending'
      )
    )
  order by r.requested_at;
$$;

comment on function public.account_deletions_due() is
  'BC-1 — cola de borrados listos para completar: sin supresiones pendientes, o con el plazo de 30 dias cumplido. La consume el route handler tras aprobar una supresion y el cron diario (BC-6). SOLO service_role.';

revoke all on function public.account_deletions_due() from public;
revoke all on function public.account_deletions_due() from authenticated, anon;
grant execute on function public.account_deletions_due() to service_role;
