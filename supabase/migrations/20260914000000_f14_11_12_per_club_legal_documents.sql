-- F14-11/12 — DOCUMENTOS LEGALES POR CLUB.
--
-- Decisión (Jose): los textos legales son INDEPENDIENTES POR CLUB (copia completa
-- por club, no plantilla compartida). El responsable del tratamiento es el CLUB;
-- Cognix Labs es el encargado. El CIF/domicilio/email del responsable van DENTRO
-- del texto de cada documento (no en columnas de clubs).
--
-- Cambios:
--   1. legal_documents += club_id (NOT NULL). "Vigente" = max(version) POR CLUB y
--      doc_type. Unique (club_id, doc_type, version).
--   2. Club nuevo → 5 documentos placeholder automáticos (trigger AFTER INSERT).
--   3. RLS: cada club solo lee SUS documentos (los loaders del alta usan
--      service_role, que hace bypass; esto acota cualquier lectura authenticated).
--   4. consents ANCLA al documento por FK legal_document_id → legal_documents(id)
--      (no por el entero suelto: la v1 del club A ≠ la v1 del club B). Se conserva
--      legal_document_version como columna denormalizada de conveniencia.
--   5. Helper current_legal_version(club, doc_type). accept_pending_invitations y
--      record_season_reconsent filtran legal_documents por club y sellan la FK.
--
-- consents es un LEDGER APPEND-ONLY (F14-1): el trigger bloquea UPDATE/DELETE
-- incluso a service_role. legal_document_id se añade NOT NULL SIN backfill: la
-- tabla está VACÍA hoy. El stop-gate de abajo aborta si tuviera filas (no se puede
-- backfillear por UPDATE), en vez de chocar con el trigger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. STOP-GATE: consents debe estar vacía (legal_document_id NOT NULL sin backfill).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.consents) then
    raise exception
      'F14-11/12: public.consents no está vacía (% filas). legal_document_id es NOT NULL y el backfill por UPDATE chocaría con el trigger append-only (F14-1). Parar y decidir la estrategia; NO desactivar el trigger.',
      (select count(*) from public.consents)
      using errcode = 'restrict_violation';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. legal_documents.club_id + reescalado de la unicidad a POR CLUB.
--    Los 5 placeholders GLOBALES de F14-1 (club_id NULL) se sustituyen por una
--    copia por cada club existente. En una BD fresca (CI) no hay clubs → quedan 0
--    filas (cada club sembrará las suyas al crearse, paso 3).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.legal_documents add column club_id uuid references public.clubs(id) on delete cascade;

-- Se sueltan la unique y el índice globales (se recrean por club más abajo).
alter table public.legal_documents drop constraint legal_documents_type_version_uniq;
drop index if exists public.legal_documents_type_version_idx;

-- Se retiran los placeholders globales (nada los referencia: consents está vacía
-- y aún no existe la FK). Tras esto la tabla queda vacía.
delete from public.legal_documents where club_id is null;

alter table public.legal_documents alter column club_id set not null;

alter table public.legal_documents
  add constraint legal_documents_club_type_version_uniq unique (club_id, doc_type, version);
create index legal_documents_club_type_version_idx
  on public.legal_documents (club_id, doc_type, version desc);

comment on column public.legal_documents.club_id is
  'F14-11/12 — club responsable del tratamiento. Los textos son independientes por club (copia completa, no plantilla). Vigente = max(version) por (club_id, doc_type).';
comment on table public.legal_documents is
  'F14-11/12 — versiones de los textos legales POR CLUB. La versión VIGENTE de cada (club_id, doc_type) es la de mayor version. El CIF/domicilio/email del responsable van dentro del body. Escritura solo service_role (script de carga / futura pantalla superadmin).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed por club: 5 placeholders (version 1). Idempotente (ON CONFLICT). Se
--    llama al crear un club (trigger) y para los clubs existentes (paso 3).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_club_legal_documents(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.legal_documents (club_id, doc_type, version, title, body) values
    (p_club_id, 'privacy_policy',           1, 'Política de Privacidad',                    'Texto pendiente del club v1'),
    (p_club_id, 'terms_conditions',         1, 'Términos y Condiciones',                    'Texto pendiente del club v1'),
    (p_club_id, 'image_internal',           1, 'Consentimiento de imagen — uso interno',    'Texto pendiente del club v1'),
    (p_club_id, 'image_social',             1, 'Consentimiento de imagen — redes sociales', 'Texto pendiente del club v1'),
    (p_club_id, 'medical_informed_consent', 1, 'Consentimiento informado de datos médicos', 'Texto pendiente del club v1')
  on conflict (club_id, doc_type, version) do nothing;
end;
$$;

comment on function public.seed_club_legal_documents(uuid) is
  'F14-11/12 — siembra los 5 documentos legales placeholder (version 1) de un club. Idempotente. Se ejecuta al crear un club (trigger) y para los clubs preexistentes en la migración.';

-- Trigger: todo club nuevo nace con sus 5 documentos placeholder.
create or replace function public.seed_club_legal_documents_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_club_legal_documents(NEW.id);
  return NEW;
end;
$$;

create trigger clubs_seed_legal_documents
  after insert on public.clubs
  for each row execute function public.seed_club_legal_documents_trg();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Sembrar los clubs EXISTENTES (en remoto: "Club Beta Test"; en CI: ninguno).
-- ─────────────────────────────────────────────────────────────────────────────
select public.seed_club_legal_documents(id) from public.clubs;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: cada club solo lee SUS documentos. Los loaders del alta usan
--    service_role (bypass) para invitees sin sesión; esto acota lo authenticated.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy legal_documents_select_authenticated on public.legal_documents;
create policy legal_documents_select_own_club on public.legal_documents
  for select to authenticated
  using (
    club_id in (select club_id from public.memberships where profile_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Helper: versión vigente (max) por club + doc_type. Espejo de active_season_id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_legal_version(p_club_id uuid, p_doc_type public.legal_document_type)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select max(version) from public.legal_documents
  where club_id = p_club_id and doc_type = p_doc_type;
$$;

comment on function public.current_legal_version(uuid, public.legal_document_type) is
  'F14-11/12 — versión VIGENTE (max) del documento p_doc_type del club p_club_id. NULL si el club no tiene ese documento.';

grant execute on function public.current_legal_version(uuid, public.legal_document_type) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. consents: ancla por FK al documento aceptado (id), no por el entero suelto.
--    Tabla vacía → NOT NULL directo sin backfill (append-only, no se puede UPDATE).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consents
  add column legal_document_id uuid not null references public.legal_documents(id);

comment on column public.consents.legal_document_id is
  'F14-11/12 — documento legal EXACTO que el tutor aceptó (FK a legal_documents.id). Ancla estable entre clubs: la v1 del club A ≠ la v1 del club B. legal_document_version queda como denormalización de conveniencia.';

create index consents_legal_document_idx on public.consents (legal_document_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. accept_pending_invitations (F14-3a/3c/4/5): filtra legal_documents por el
--    club de la invitación (v_anchor_club) y sella la FK legal_document_id.
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
  'F14-3a/3c/4/5/9 — Alta multi-hijo ATÓMICA. Consentimientos sellados con season_id (temporada activa) y legal_document_id (documento VIGENTE del club de la invitación). Todo o nada. SECURITY DEFINER.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. record_season_reconsent (F14-5): filtra legal_documents por p_club_id y sella
--    la FK legal_document_id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_season_reconsent(
  p_club_id uuid,
  p_accept_terms boolean default false,
  p_accept_privacy boolean default false,
  p_ip text default null,
  p_user_agent text default null,
  p_children jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_season uuid;
  v_is_tutor boolean;
  v_terms_id uuid;        v_terms_version int;
  v_privacy_id uuid;      v_privacy_version int;
  v_img_internal_id uuid; v_img_internal_version int;
  v_img_social_id uuid;   v_img_social_version int;
  v_med_id uuid;          v_med_version int;
  v_ip inet;
  v_pid uuid;
  v_child jsonb;
  v_internal boolean;
  v_social boolean;
  v_medical boolean;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  perform pg_advisory_xact_lock(hashtext('reconsent:' || v_uid::text));

  -- Debe ser tutor de este club.
  select exists (
    select 1
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    where pa.profile_id = v_uid
      and pa.relation in ('parent', 'guardian')
      and pl.club_id = p_club_id
  ) into v_is_tutor;
  if not v_is_tutor then
    raise exception 'forbidden';
  end if;

  v_season := public.active_season_id(p_club_id);
  if v_season is null then
    raise exception 'no_active_season';
  end if;

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- F14-11/12 — documentos VIGENTES del club (id + version).
  select id, version into v_terms_id, v_terms_version from legal_documents
    where club_id = p_club_id and doc_type = 'terms_conditions' order by version desc limit 1;
  select id, version into v_privacy_id, v_privacy_version from legal_documents
    where club_id = p_club_id and doc_type = 'privacy_policy' order by version desc limit 1;
  select id, version into v_img_internal_id, v_img_internal_version from legal_documents
    where club_id = p_club_id and doc_type = 'image_internal' order by version desc limit 1;
  select id, version into v_img_social_id, v_img_social_version from legal_documents
    where club_id = p_club_id and doc_type = 'image_social' order by version desc limit 1;
  select id, version into v_med_id, v_med_version from legal_documents
    where club_id = p_club_id and doc_type = 'medical_informed_consent' order by version desc limit 1;

  -- ── Obligatorios: deben aceptarse; se sellan a la temporada activa ──────────
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

  -- ── Opcionales por hijo: SOLO los decididos (no null) generan INSERT ────────
  for v_pid, v_child in
    select key::uuid, value from jsonb_each(coalesce(p_children, '{}'::jsonb))
  loop
    -- El jugador debe ser hijo del tutor en este club (si no, ignora la clave).
    if not exists (
      select 1 from public.player_accounts pa
      join public.players pl on pl.id = pa.player_id
      where pa.profile_id = v_uid and pa.player_id = v_pid
        and pa.relation in ('parent', 'guardian')
        and pl.club_id = p_club_id
    ) then
      raise exception 'player_not_in_batch';
    end if;

    if v_child ? 'internal' and (v_child ->> 'internal') is not null and v_img_internal_version is not null then
      v_internal := (v_child ->> 'internal')::boolean;
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'image_internal', v_internal, v_img_internal_id, v_img_internal_version, v_season, v_ip, p_user_agent);
    end if;

    if v_child ? 'social' and (v_child ->> 'social') is not null and v_img_social_version is not null then
      v_social := (v_child ->> 'social')::boolean;
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'image_social', v_social, v_img_social_id, v_img_social_version, v_season, v_ip, p_user_agent);
    end if;

    if v_child ? 'medical' and (v_child ->> 'medical') is not null and v_med_version is not null then
      v_medical := (v_child ->> 'medical')::boolean;
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'medical_data_processing', v_medical, v_med_id, v_med_version, v_season, v_ip, p_user_agent);
    end if;
  end loop;
end;
$$;

comment on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) is
  'F14-5/9 — Envío de la pantalla de re-consentimiento. Sella los OBLIGATORIOS y los OPCIONALES DECIDIDOS a la temporada activa y al legal_document_id VIGENTE del club del tutor, en UNA transacción. SECURITY DEFINER, auth.uid() interno.';

revoke all on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) from public;
grant execute on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) to authenticated;
