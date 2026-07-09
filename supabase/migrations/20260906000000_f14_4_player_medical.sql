-- F14-4 — INFO MÉDICA del menor: tabla propia + consentimiento informado + acceso por equipo.
--
-- Categoría especial (RGPD art. 9). Cierra dos huecos reales:
--   §3 LECTURA: players_select_member exponía la fila entera de players (incl.
--      medical_notes) a cualquier miembro del club → la médica sale de players a
--      una tabla propia player_medical con RLS que NO la expone.
--   §4 ESCRITURA: players_write_staff (FOR ALL) permitía a can_manage_squad
--      escribir medical_notes por UPDATE directo → la médica ya no vive en players;
--      player_medical solo la escribe el TUTOR con consentimiento vigente.
--
-- Reglas (Jose): la genera EL TUTOR en el alta (opcional, tras consentimiento
-- informado por hijo). Staff NO escribe nunca. Lectura: staff del EQUIPO del niño
-- (scope EQUIPO), staff de equipo que lo PROMOCIONA (mientras exista la subida),
-- dirección/admin y tutor. Cuatro campos estructurados.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla player_medical (saca la médica de players).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.player_medical (
  player_id          uuid primary key references public.players(id) on delete cascade,
  allergies          text check (allergies is null or char_length(allergies) <= 2000),
  medication         text check (medication is null or char_length(medication) <= 2000),
  medical_conditions text check (medical_conditions is null or char_length(medical_conditions) <= 4000),
  emergency_contact  text check (emergency_contact is null or char_length(emergency_contact) <= 500),
  updated_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);

comment on table public.player_medical is
  'F14-4 — Info médica del menor (categoría especial RGPD art. 9). Fuera de players para que la RLS no la exponga. La escribe SOLO el tutor con consentimiento vigente; la lee staff del equipo del niño / equipo que lo promociona / dirección / tutor, y solo si hay consentimiento.';

-- updated_by/updated_at autoritativos (no se confía en el cliente).
create or replace function public.player_medical_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger player_medical_touch
  before insert or update on public.player_medical
  for each row execute function public.player_medical_touch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helpers.
-- ─────────────────────────────────────────────────────────────────────────────

-- ¿Hay consentimiento médico VIGENTE para el hijo? Latest-wins por accepted_at
-- (tolera re-consentimiento / retirada futura sin depender de append-only).
create or replace function public.user_has_medical_consent(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'medical_data_processing'
      and c.legal_document_version = (
        select max(version) from public.legal_documents
        where doc_type = 'medical_informed_consent'
      )
    order by c.accepted_at desc
    limit 1
  ), false);
$$;

comment on function public.user_has_medical_consent(uuid) is
  'F14-4 — TRUE si el hijo tiene consentimiento médico VIGENTE (consents medical_data_processing granted=true a la versión vigente de medical_informed_consent, latest-wins).';

grant execute on function public.user_has_medical_consent(uuid) to authenticated;

-- ¿Quién puede ACCEDER (leer) a la médica? Scope de staff SIEMPRE por EQUIPO
-- (user_is_staff_of_team), NUNCA por rol de club (patrón de bug recurrente).
create or replace function public.user_can_access_player_medical(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- dirección / admin del club del jugador
    public.user_is_admin_or_director(
      (select club_id from public.players where id = p_player_id)
    )
    -- staff de un equipo ACTIVO del jugador (equipo base) — scope EQUIPO
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = p_player_id
        and tm.left_at is null
        and public.user_is_staff_of_team(tm.team_id)
    )
    -- staff de un equipo que lo tiene PROMOCIONADO (mientras exista la subida)
    or exists (
      select 1 from public.player_promotions pp
      where pp.player_id = p_player_id
        and public.user_is_staff_of_team(pp.team_id)
    )
    -- tutor vinculado
    or public.user_is_tutor_of_player(p_player_id);
$$;

comment on function public.user_can_access_player_medical(uuid) is
  'F14-4 — TRUE si el user puede LEER la médica del jugador: dirección/admin del club, staff (por EQUIPO, user_is_staff_of_team) del equipo base o de un equipo que lo promociona (player_promotions), o tutor. La visibilidad efectiva exige además consentimiento (ver policy).';

grant execute on function public.user_can_access_player_medical(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS de player_medical.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.player_medical enable row level security;

-- SELECT: quien puede acceder Y con consentimiento vigente. Sin consentimiento la
-- fila es invisible para TODOS (así los datos migrados de staff quedan ocultos
-- hasta que el tutor consienta).
create policy player_medical_select on public.player_medical
  for select to authenticated
  using (
    public.user_can_access_player_medical(player_id)
    and public.user_has_medical_consent(player_id)
  );

-- INSERT/UPDATE/DELETE: SOLO el tutor vinculado Y con consentimiento vigente. El
-- staff NO escribe por ninguna vía (players_write_staff es sobre players, no aquí).
create policy player_medical_insert_tutor on public.player_medical
  for insert to authenticated
  with check (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent(player_id)
  );

create policy player_medical_update_tutor on public.player_medical
  for update to authenticated
  using (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent(player_id)
  )
  with check (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent(player_id)
  );

create policy player_medical_delete_tutor on public.player_medical
  for delete to authenticated
  using (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent(player_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Migración de players.medical_notes existente → player_medical.medical_conditions.
--    Se PRESERVA el dato y se VACÍA la columna en players (§3 cerrado: select *
--    de players ya no devuelve médica). La columna se deja para retirarla en una
--    migración posterior (no se borra a lo bruto). Los datos migrados NO tienen
--    consentimiento → invisibles por la policy SELECT hasta que el tutor consienta.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.player_medical (player_id, medical_conditions, updated_by, updated_at)
select p.id, p.medical_notes, null, now()
from public.players p
where p.medical_notes is not null and btrim(p.medical_notes) <> ''
on conflict (player_id) do nothing;

update public.players set medical_notes = null where medical_notes is not null;

comment on column public.players.medical_notes is
  'DEPRECADO (F14-4): la médica vive ahora en player_medical. Columna vaciada y sin lectores; pendiente de retirar en migración posterior.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. accept_pending_invitations gana p_medical jsonb (consentimiento + 4 campos
--    por hijo), en la MISMA transacción. Médica OPCIONAL (no gatea el alta).
--    Firma cambia → DROP + CREATE (mantiene todo lo de 3a/3c).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb);

create function public.accept_pending_invitations(
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
  v_terms_version int;
  v_privacy_version int;
  v_img_internal_version int;
  v_img_social_version int;
  v_med_version int;
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

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  select max(version) into v_terms_version from legal_documents where doc_type = 'terms_conditions';
  select max(version) into v_privacy_version from legal_documents where doc_type = 'privacy_policy';
  select max(version) into v_img_internal_version from legal_documents where doc_type = 'image_internal';
  select max(version) into v_img_social_version from legal_documents where doc_type = 'image_social';
  select max(version) into v_med_version from legal_documents where doc_type = 'medical_informed_consent';

  -- Consentimientos de cuenta (T&C + Privacidad), una vez.
  if v_terms_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions' and granted and legal_document_version = v_terms_version
     ) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_version, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy' and granted and legal_document_version = v_privacy_version
     ) then
    if not p_accept_privacy then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_version, v_ip, p_user_agent);
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
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_internal', v_internal, v_img_internal_version, v_ip, p_user_agent);
      end if;
      if v_img_social_version is not null then
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_social', v_social, v_img_social_version, v_ip, p_user_agent);
      end if;
      update players set photo_url = v_path where id = v_inv.player_id;

      -- ── F14-4 — médica (OPCIONAL, no gatea) ─────────────────────────────────
      v_med := p_medical -> v_inv.player_id::text;
      if v_med is not null and (v_med ? 'consent') and v_med_version is not null then
        v_med_consent := (v_med ->> 'consent')::boolean;
        if v_med_consent is not null then
          insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
          values (v_uid, v_inv.player_id, 'medical_data_processing', v_med_consent, v_med_version, v_ip, p_user_agent);
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
  'F14-3a/3c/4 — Alta multi-hijo ATÓMICA. Consentimientos de cuenta + por hijo (imagen obligatoria + médica OPCIONAL) + foto + (si consiente y aporta) fila player_medical. Todo o nada. p_children={player_id:{internal,social,path}}, p_medical={player_id:{consent,allergies,medication,medical_conditions,emergency_contact}}. SECURITY DEFINER.';

revoke all on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb, jsonb) from public;
grant execute on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb, jsonb) to authenticated;
