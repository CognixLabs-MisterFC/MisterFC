-- F14-7 — DERECHO AL OLVIDO (supresión). Solicitud del tutor → aprobación de
-- admin_club/director → OCULTACIÓN inmediata (foto y médica BORRADAS de verdad;
-- resto de PII bloqueada) → BORRADO FÍSICO manual a los 5 años (scrub irreversible).
--
-- El borrado físico NO es un DELETE de players: la FK de consents (NO ACTION) y el
-- ledger append-only lo impiden, y arrasaría el histórico. Físico = scrub de las
-- columnas PII dejando viva la fila con el nombre de pila. Consents e histórico
-- sobreviven (bloqueo, LOPDGDD art. 32).
--
-- Reglas de producto (Jose):
--  1. Solicita el tutor; aprueban admin_club O director (user_is_admin_or_director).
--  2. Al APROBAR: se BORRAN foto (objeto + photo_url) y fila player_medical; el
--     resto de PII (apellidos, dob, invite_email, atributos) queda OCULTO, no borrado.
--  3. Ficha del menor suprimido: INACCESIBLE (guard server-side).
--  4. Histórico: se conserva y muestra SOLO el nombre de pila.
--  5. Texto libre del histórico (evaluations, notes, reports, messages): NO se toca.
--  6. Físico (5 años, manual): last_name/invite_email/atributos → NULL; dob y
--     first_name CONSERVADOS; fila, consents e histórico sobreviven.
--  7. Baja (left_club_at, C11a) NO es supresión: no se toca.
--  8. Sin automatismo de 5 años: solo la RPC lista para el director.
--
-- CHOKEPOINT del NOMBRE (regla 4, sin whack-a-mole en 21 vistas): en la APROBACIÓN
-- el apellido se MUEVE de `last_name` a `last_name_blocked` (bloqueo) y `last_name`
-- queda NULL → toda la app muestra solo el nombre de pila por el manejo de NULL ya
-- existente en formatPlayerName (F2.9). El apellido NO se borra: queda bloqueado y
-- recuperable hasta el borrado físico, que vacía `last_name_blocked` (irreversible).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. players: estado de supresión + apellido bloqueado.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.players
  add column erased_at        timestamptz,
  add column erased_by        uuid references public.profiles(id),
  add column last_name_blocked text
    check (last_name_blocked is null or char_length(last_name_blocked) between 1 and 120);

comment on column public.players.erased_at is
  'F14-7 — NULL = jugador normal; fecha = supresión APROBADA (derecho al olvido). Oculta la ficha, la foto, la médica y enmascara el nombre a solo nombre de pila. NO es baja (left_club_at).';
comment on column public.players.last_name_blocked is
  'F14-7 — apellido BLOQUEADO tras la aprobación (last_name pasa a NULL para ocultarlo en toda la app). Recuperable hasta el borrado físico (5 años), que lo vacía de forma irreversible. LOPDGDD art. 32.';

-- Excluir suprimidos de los listados activos (mismo idiom que left_club_at).
create index players_not_erased_idx on public.players (club_id) where erased_at is null;

-- El guard de la foto (F14-3b) es tutor-exclusivo y bloquearía que la RPC de
-- supresión (admin/director, auth.uid() no nulo y no tutor) ponga photo_url a
-- NULL. Se amplía la exención SOLO para ese caso: poner la foto a NULL cuando el
-- jugador queda suprimido. No reabre la escritura de fotos al staff (solo NULL, y
-- solo con erased_at). Réplica additiva de F14-3b.
create or replace function public.players_guard_photo_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.photo_url is distinct from OLD.photo_url then
    -- F14-7: la supresión puede RETIRAR la foto (photo_url -> NULL) al suprimir.
    if NEW.erased_at is not null and NEW.photo_url is null then
      return NEW;
    end if;
    -- auth.uid() null = backend con service_role (alta server-side, F14-3c): permitido.
    if auth.uid() is not null and not public.user_is_tutor_of_player(NEW.id) then
      raise exception 'photo_url solo la gestiona el tutor vinculado (usa set_player_photo)';
    end if;
  end if;
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. erasure_requests — solicitud del tutor, decisión de admin/director.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.erasure_requests (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  club_id       uuid not null references public.clubs(id) on delete cascade,
  requested_by  uuid not null references public.profiles(id),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references public.profiles(id),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  reason        text check (reason is null or char_length(reason) <= 500)
);

comment on table public.erasure_requests is
  'F14-7 — solicitudes de supresión (derecho al olvido). Las crea el tutor; las decide admin_club/director. Una sola pending por jugador.';

-- Una única solicitud pendiente por jugador (idempotencia de la solicitud).
create unique index erasure_requests_one_pending on public.erasure_requests (player_id) where status = 'pending';
create index erasure_requests_club_idx on public.erasure_requests (club_id, status, requested_at desc);

alter table public.erasure_requests enable row level security;

-- SELECT: el tutor ve las suyas; admin/director ven las de su club. Escritura solo
-- vía RPC (SECURITY DEFINER) → sin policies de INSERT/UPDATE/DELETE de cliente.
create policy erasure_requests_select on public.erasure_requests
  for select to authenticated
  using (
    requested_by = auth.uid()
    or public.user_is_admin_or_director(club_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. player_photo_visible (F14-5): además de la retirada de imagen, OCULTA la
--    foto si el jugador está suprimido. Chokepoint en la RLS de storage.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_photo_visible(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.players p where p.id = p_player_id and p.erased_at is not null
    ) then false
    else coalesce((
      select c.granted
      from public.consents c
      where c.player_id = p_player_id and c.consent_type = 'image_internal'
      order by c.accepted_at desc
      limit 1
    ), true)
  end;
$$;

comment on function public.player_photo_visible(uuid) is
  'F14-5/F14-7 — FALSE si el jugador está suprimido (erased_at) o si el último image_internal es granted=false; si no, TRUE (sin fila → visible). Chokepoint de la RLS de storage player-photos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_player_medical (F14-6): guard extra — jugador suprimido → vacío (la fila
--    ya no existe tras la aprobación, pero el guard queda explícito).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_player_medical(
  p_player_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns table (
  allergies text,
  medication text,
  medical_conditions text,
  emergency_contact text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_medical%rowtype;
  v_club uuid;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- F14-7 — jugador suprimido: sin médica (además la fila ya se borró al aprobar).
  if exists (select 1 from public.players where id = p_player_id and erased_at is not null) then
    return;
  end if;

  if not (
    public.user_can_access_player_medical(p_player_id)
    and public.user_has_medical_consent_read(p_player_id)
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.player_medical where player_id = p_player_id;

  if v_row.player_id is null or (
       v_row.allergies is null
   and v_row.medication is null
   and v_row.medical_conditions is null
   and v_row.emergency_contact is null
  ) then
    return;
  end if;

  if not public.user_is_tutor_of_player(p_player_id) then
    select club_id into v_club from public.players where id = p_player_id;
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid, 'medical.read', 'player_medical', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select v_row.allergies, v_row.medication, v_row.medical_conditions, v_row.emergency_contact;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC request_player_erasure — el TUTOR solicita. Idempotente (una pending).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.request_player_erasure(
  p_player_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;
  if not public.user_is_tutor_of_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  select club_id into v_club from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('erasure_req:' || p_player_id::text));

  -- Idempotente: si ya hay una pendiente, se devuelve sin crear otra ni auditar.
  select id into v_existing from public.erasure_requests
   where player_id = p_player_id and status = 'pending' limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.erasure_requests (player_id, club_id, requested_by, reason)
  values (p_player_id, v_club, v_uid, nullif(btrim(p_reason), ''))
  returning id into v_id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'erasure.requested', 'player', p_player_id, v_club, nullif(btrim(p_reason), ''));

  return v_id;
end;
$$;

comment on function public.request_player_erasure(uuid, text) is
  'F14-7 — el tutor solicita la supresión de su hijo. Idempotente (una pending por jugador). Audita erasure.requested.';

revoke all on function public.request_player_erasure(uuid, text) from public;
grant execute on function public.request_player_erasure(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC decide_player_erasure — admin/director aprueba o rechaza. TODO EN UNA
--    TRANSACCIÓN. Al aprobar: OCULTA (borra foto+médica, bloquea apellido). Devuelve
--    la ruta de la foto ANTIGUA para que el server action borre el objeto (Storage
--    API; SQL no puede por storage.protect_delete). NULL si rechaza o sin foto.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.decide_player_erasure(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.erasure_requests%rowtype;
  v_photo text;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  select * into v_req from public.erasure_requests where id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'already_decided';
  end if;
  if not public.user_is_admin_or_director(v_req.club_id) then
    raise exception 'forbidden';
  end if;

  if not p_approve then
    update public.erasure_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           reason = coalesce(nullif(btrim(p_reason), ''), reason)
     where id = p_request_id;
    insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
    values (v_uid, 'erasure.rejected', 'player', v_req.player_id, v_req.club_id, nullif(btrim(p_reason), ''));
    return null;
  end if;

  -- APROBAR: ocultación inmediata.
  select photo_url into v_photo from public.players where id = v_req.player_id;

  update public.players
     set erased_at        = now(),
         erased_by        = v_uid,
         last_name_blocked = last_name,   -- bloqueo del apellido (recuperable hasta el físico)
         last_name        = null,          -- oculto en toda la app (nombre de pila)
         photo_url        = null,          -- foto borrada (objeto lo quita el server action)
         updated_at       = now()
   where id = v_req.player_id;

  -- La médica se BORRA de verdad (no es prueba legal ni fiscal). Owner: la tabla
  -- está cerrada al cliente desde F14-6, pero esta RPC corre como owner.
  delete from public.player_medical where player_id = v_req.player_id;

  update public.erasure_requests
     set status = 'approved', decided_by = v_uid, decided_at = now(),
         reason = coalesce(nullif(btrim(p_reason), ''), reason)
   where id = p_request_id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'erasure.approved', 'player', v_req.player_id, v_req.club_id, nullif(btrim(p_reason), ''));
  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'medical.delete', 'player_medical', v_req.player_id, v_req.club_id, null);
  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'player.photo_delete', 'player', v_req.player_id, v_req.club_id, null);

  return v_photo;  -- ruta del objeto a borrar por Storage API (NULL si no había foto)
end;
$$;

comment on function public.decide_player_erasure(uuid, boolean, text) is
  'F14-7 — admin/director decide una solicitud de supresión. Aprobar: erased_at, borra foto (photo_url + devuelve ruta para Storage API) y fila player_medical, bloquea apellido; audita erasure.approved + medical.delete + player.photo_delete. Rechazar: status rejected + erasure.rejected. Todo en una transacción.';

revoke all on function public.decide_player_erasure(uuid, boolean, text) from public;
grant execute on function public.decide_player_erasure(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC physically_erase_player — borrado FÍSICO manual (5 años). Scrub
--    irreversible; conserva first_name, date_of_birth, la fila, consents e histórico.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.physically_erase_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_erased timestamptz;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  select club_id, erased_at into v_club, v_erased from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;
  if not public.user_is_admin_or_director(v_club) then
    raise exception 'forbidden';
  end if;
  -- No se puede saltar la aprobación: exige supresión previa.
  if v_erased is null then
    raise exception 'not_erased';
  end if;

  -- Scrub irreversible. positions_secondary es NOT NULL default '{}' → se vacía.
  update public.players
     set last_name         = null,
         last_name_blocked = null,   -- se elimina el apellido bloqueado (irreversible)
         invite_email      = null,
         height_cm         = null,
         weight_kg         = null,
         foot              = null,
         origin            = null,
         dorsal            = null,
         position_main     = null,
         positions_secondary = '{}'::text[],
         updated_at        = now()
   where id = p_player_id;
  -- CONSERVA: first_name, date_of_birth, la fila players, los consents y el histórico.

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'erasure.physical_delete', 'player', p_player_id, v_club, null);
end;
$$;

comment on function public.physically_erase_player(uuid) is
  'F14-7 — borrado FÍSICO manual (5 años, admin/director). Exige erased_at previo. Scrub irreversible de PII (apellido bloqueado incluido, atributos, invite_email); conserva first_name, date_of_birth, la fila, consents e histórico. Audita erasure.physical_delete. Sin automatismo.';

revoke all on function public.physically_erase_player(uuid) from public;
grant execute on function public.physically_erase_player(uuid) to authenticated;
