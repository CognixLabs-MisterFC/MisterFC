-- F14C-2 — INVITACIÓN DE SEGUIDOR/ESPECTADOR (por email) + accept que crea SOLO
-- player_spectators.
--
-- El tutor de un jugador (user_is_tutor_of_player) o el PROPIO jugador
-- (player_accounts relation='self') invitan a un seguidor (abuelo/familiar) por
-- email. El seguidor acepta y queda ligado al jugador vía player_spectators
-- (F14C-1). SOLO LECTURA. El ACCESO deportivo es F14C-3; aquí NO se concede nada,
-- solo se crea el vínculo.
--
-- MARCA de invitación de seguidor: role='spectator' en invitations. Un seguidor
-- NO tiene rol de club ni de equipo → nunca se le crea membership ni player_account.
--
-- RIESGO CENTRAL (Jose): aceptar como seguidor debe crear SOLO la fila
-- player_spectators. La rama del seguidor en accept_pending_invitations es SEPARADA
-- y mínima (continue antes de la lógica de membership/player_account/consent/imagen).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Marca 'spectator' en invitations.role + coherencia + cerrar el insert cliente
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 role: añadir 'spectator' al CHECK (copia fiel del vigente F1B-2 + 'spectator').
alter table public.invitations
  drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check check (role in (
    'admin_club',
    'director',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador',
    'spectator'
  ));

-- 1.2 Coherencia rol/player_id/relation: el seguidor lleva player_id (a quién sigue)
--     y NO lleva player_relation. Copia fiel del vigente + rama spectator.
alter table public.invitations
  drop constraint if exists invitations_player_role_consistency;
alter table public.invitations
  add constraint invitations_player_role_consistency check (
    -- (a) Rol ni jugador ni seguidor → sin vinculación a player.
    (role <> 'jugador' and role <> 'spectator' and player_id is null and player_relation is null)
    -- (b) Jugador adulto auto-invitándose (sin vinculación).
    or (role = 'jugador' and player_id is null and player_relation is null)
    -- (c) Tutor de un jugador: player_id + relation.
    or (role = 'jugador' and player_id is not null and player_relation is not null)
    -- (d) Seguidor de un jugador: player_id, SIN relation (no es tutor).
    or (role = 'spectator' and player_id is not null and player_relation is null)
  );

-- 1.3 El insert de cliente NO puede crear invitaciones de seguidor: solo el RPC
--     invite_spectator (SECURITY DEFINER, exento de RLS) las crea, con su gate
--     tutor/self. Copia fiel de la policy vigente + guard role <> 'spectator'.
drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin on public.invitations
  for insert to authenticated
  with check (
    role <> 'spectator'
    and case
      when public.membership_role_is_high(role)
        then public.user_is_club_owner(club_id)
      else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
    end
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC invite_spectator(player, email) — crea la invitación de seguidor.
--    Gate: tutor del jugador O el propio jugador (self). Reinvitable (supersede).
-- ─────────────────────────────────────────────────────────────────────────────

create function public.invite_spectator(p_player_id uuid, p_email text)
returns table (id uuid, token uuid, email text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_email text := lower(btrim(p_email));
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate estricto: SOLO el tutor del jugador o el propio jugador (self).
  -- Ni admin, ni otro seguidor. Un seguidor NO invita a otro seguidor.
  if not (
    public.user_is_tutor_of_player(p_player_id)
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = p_player_id
        and pa.profile_id = v_uid
        and pa.relation = 'self'
    )
  ) then
    raise exception 'forbidden';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select club_id into v_club from public.players where players.id = p_player_id;
  if v_club is null then
    raise exception 'forbidden';
  end if;

  -- Reinvitable: supersede las invitaciones de seguidor PENDIENTES del mismo
  -- (email, jugador) — como invitations no tiene unique, borramos las previas.
  delete from public.invitations i
  where i.role = 'spectator'
    and i.player_id = p_player_id
    and lower(btrim(i.email)) = v_email
    and i.accepted_at is null;

  return query
  insert into public.invitations (email, club_id, role, player_id, created_by)
  values (v_email, v_club, 'spectator', p_player_id, v_uid)
  returning invitations.id, invitations.token, invitations.email;
end;
$$;

comment on function public.invite_spectator(uuid, text) is
  'F14C-2 — Crea una invitación de SEGUIDOR/espectador (role=spectator, player_id, '
  'created_by=caller) por email. Gate: tutor del jugador O el propio jugador '
  '(player_accounts relation=self); nadie más. Reinvitable (supersede las '
  'pendientes del mismo email+jugador). Devuelve (id, token, email) para que la '
  'accion envie el email (inviteUserByEmail con invitation_id). El accept crea '
  'SOLO player_spectators.';

revoke all on function public.invite_spectator(uuid, text) from public;
grant execute on function public.invite_spectator(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC remove_spectator(player, spectator) — revocación simple.
--    Gate: quien puede invitar (tutor o jugador self) puede revocar.
-- ─────────────────────────────────────────────────────────────────────────────

create function public.remove_spectator(p_player_id uuid, p_spectator_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  if not (
    public.user_is_tutor_of_player(p_player_id)
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = p_player_id
        and pa.profile_id = v_uid
        and pa.relation = 'self'
    )
  ) then
    raise exception 'forbidden';
  end if;

  delete from public.player_spectators ps
  where ps.player_id = p_player_id
    and ps.spectator_profile_id = p_spectator_profile_id;
end;
$$;

comment on function public.remove_spectator(uuid, uuid) is
  'F14C-2 — Revoca a un seguidor de un jugador (DELETE player_spectators). Gate: '
  'tutor del jugador O el propio jugador (self) — quien puede invitar puede revocar. '
  'La UI es F14C-5.';

revoke all on function public.remove_spectator(uuid, uuid) from public;
grant execute on function public.remove_spectator(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. accept_pending_invitations — rama SEGUIDOR al principio del loop.
--    CREATE OR REPLACE: copia FIEL de la versión VIGENTE (F14-11/12, mig 20260914,
--    con season_id + legal_document_id + docs POR CLUB + guard no_active_season),
--    con SOLO el añadido de la rama role='spectator' (crea player_spectators y
--    continue; nada de membership/player_account/consent/imagen/médica).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.accept_pending_invitations(
  p_clicked_token uuid,
  p_accept_terms boolean default false,
  p_accept_privacy boolean default false,
  p_ip text default null,
  p_user_agent text default null,
  p_children jsonb default '{}'::jsonb,
  p_medical jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_anchor_email text;
  v_anchor_club uuid;
  v_season uuid;
  v_terms_id uuid;        v_terms_version int;
  v_privacy_id uuid;      v_privacy_version int;
  v_img_internal_id uuid; v_img_internal_version int;
  v_img_social_id uuid;   v_img_social_version int;
  v_med_id uuid;          v_med_version int;
  v_ip inet;
  v_inv record;
  v_membership_id uuid;
  v_processed int := 0;
  v_batch_players text[] := '{}';
  v_child jsonb;
  v_internal boolean;
  v_social boolean;
  v_path text;
  v_med jsonb;
  v_med_consent boolean;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  perform pg_advisory_xact_lock(hashtext('accept_pending:' || v_uid::text));

  select email into v_email from auth.users where id = v_uid;

  select email, club_id into v_anchor_email, v_anchor_club
  from invitations where token = p_clicked_token;
  if not found then
    raise exception 'not_found';
  end if;

  if v_email is null
     or lower(btrim(v_email)) <> lower(btrim(v_anchor_email)) then
    raise exception 'wrong_email';
  end if;

  -- F14-5 — sellar la temporada activa del club de la invitación en cada consent.
  v_season := public.active_season_id(v_anchor_club);
  if v_season is null then
    raise exception 'no_active_season';
  end if;

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- F14-11/12 — documentos VIGENTES del club de la invitación (id + version).
  select id, version into v_terms_id, v_terms_version from legal_documents
    where club_id = v_anchor_club and doc_type = 'terms_conditions' order by version desc limit 1;
  select id, version into v_privacy_id, v_privacy_version from legal_documents
    where club_id = v_anchor_club and doc_type = 'privacy_policy' order by version desc limit 1;
  select id, version into v_img_internal_id, v_img_internal_version from legal_documents
    where club_id = v_anchor_club and doc_type = 'image_internal' order by version desc limit 1;
  select id, version into v_img_social_id, v_img_social_version from legal_documents
    where club_id = v_anchor_club and doc_type = 'image_social' order by version desc limit 1;
  select id, version into v_med_id, v_med_version from legal_documents
    where club_id = v_anchor_club and doc_type = 'medical_informed_consent' order by version desc limit 1;

  -- Consentimientos de cuenta (T&C + Privacidad), una vez POR TEMPORADA.
  if v_terms_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions' and granted and season_id = v_season
     ) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_id, v_terms_version, v_season, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy' and granted and season_id = v_season
     ) then
    if not p_accept_privacy then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_id, v_privacy_version, v_season, v_ip, p_user_agent);
  end if;

  for v_inv in
    select * from invitations
    where lower(btrim(email)) = lower(btrim(v_anchor_email))
      and club_id = v_anchor_club
      and accepted_at is null
      and expires_at > now()
    order by created_at
    for update
  loop
    -- ── F14C-2 — rama SEGUIDOR: crea SOLO player_spectators, NADA más. ──────────
    if v_inv.role = 'spectator' then
      if v_inv.player_id is not null then
        insert into player_spectators (spectator_profile_id, player_id, invited_by_profile_id)
        values (v_uid, v_inv.player_id, v_inv.created_by)
        on conflict (spectator_profile_id, player_id) do nothing;
      end if;
      update invitations set accepted_at = now()
      where id = v_inv.id and accepted_at is null;
      v_processed := v_processed + 1;
      continue;
    end if;

    insert into memberships (profile_id, club_id, role)
    values (v_uid, v_inv.club_id, v_inv.role)
    on conflict (profile_id, club_id) do nothing;

    select id into v_membership_id
    from memberships where profile_id = v_uid and club_id = v_inv.club_id;

    if v_inv.role = 'jugador' and v_inv.player_id is not null and v_inv.player_relation is not null then
      insert into player_accounts (player_id, profile_id, relation)
      values (v_inv.player_id, v_uid, v_inv.player_relation)
      on conflict (player_id, profile_id) do nothing;
    end if;

    if v_inv.team_id is not null and v_inv.team_staff_role is not null and v_membership_id is not null then
      begin
        insert into team_staff (team_id, membership_id, staff_role)
        values (v_inv.team_id, v_membership_id, v_inv.team_staff_role);
      exception when unique_violation then null;
      end;
    end if;

    -- ── F14-3c — imagen (obligatoria) ──────────────────────────────────────────
    if v_inv.role = 'jugador' and v_inv.player_id is not null then
      v_batch_players := v_batch_players || v_inv.player_id::text;
      v_child := p_children -> v_inv.player_id::text;
      if v_child is null then raise exception 'image_required'; end if;
      v_internal := (v_child ->> 'internal')::boolean;
      v_social := (v_child ->> 'social')::boolean;
      v_path := v_child ->> 'path';
      if v_internal is null or v_social is null then raise exception 'image_decision_required'; end if;
      if v_path is null or btrim(v_path) = '' or v_path not like (v_inv.player_id::text || '/%') then
        raise exception 'image_required';
      end if;
      if v_img_internal_version is not null then
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_internal', v_internal, v_img_internal_id, v_img_internal_version, v_season, v_ip, p_user_agent);
      end if;
      if v_img_social_version is not null then
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_social', v_social, v_img_social_id, v_img_social_version, v_season, v_ip, p_user_agent);
      end if;
      update players set photo_url = v_path where id = v_inv.player_id;

      -- ── F14-4 — médica (OPCIONAL, no gatea) ─────────────────────────────────
      v_med := p_medical -> v_inv.player_id::text;
      if v_med is not null and (v_med ? 'consent') and v_med_version is not null then
        v_med_consent := (v_med ->> 'consent')::boolean;
        if v_med_consent is not null then
          insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
          values (v_uid, v_inv.player_id, 'medical_data_processing', v_med_consent, v_med_id, v_med_version, v_season, v_ip, p_user_agent);
          -- Solo si consiente Y aporta algún dato se guarda la fila médica.
          if v_med_consent and (
               nullif(btrim(coalesce(v_med ->> 'allergies', '')), '') is not null
            or nullif(btrim(coalesce(v_med ->> 'medication', '')), '') is not null
            or nullif(btrim(coalesce(v_med ->> 'medical_conditions', '')), '') is not null
            or nullif(btrim(coalesce(v_med ->> 'emergency_contact', '')), '') is not null
          ) then
            insert into player_medical (player_id, allergies, medication, medical_conditions, emergency_contact, updated_by)
            values (
              v_inv.player_id,
              nullif(btrim(coalesce(v_med ->> 'allergies', '')), ''),
              nullif(btrim(coalesce(v_med ->> 'medication', '')), ''),
              nullif(btrim(coalesce(v_med ->> 'medical_conditions', '')), ''),
              nullif(btrim(coalesce(v_med ->> 'emergency_contact', '')), ''),
              v_uid
            )
            on conflict (player_id) do update set
              allergies = excluded.allergies,
              medication = excluded.medication,
              medical_conditions = excluded.medical_conditions,
              emergency_contact = excluded.emergency_contact,
              updated_by = excluded.updated_by;
          end if;
        end if;
      end if;
    end if;

    update invitations set accepted_at = now()
    where id = v_inv.id and accepted_at is null;

    v_processed := v_processed + 1;
  end loop;

  if exists (
    select 1 from jsonb_object_keys(p_children) as k
    where not (k = any (v_batch_players))
  ) then
    raise exception 'player_not_in_batch';
  end if;

  return v_processed;
end;
$$;

comment on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb, jsonb) is
  'F14-3a/3c/4/5/9 + F14C-2 — Alta multi-hijo ATÓMICA. Consentimientos sellados con season_id (temporada activa) y legal_document_id (documento VIGENTE del club de la invitación). Rama SEGUIDOR (role=spectator): crea SOLO player_spectators, sin membership ni player_account. Todo o nada. SECURITY DEFINER.';
