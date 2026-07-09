-- F14-5 — RE-CONSENTIMIENTO POR TEMPORADA.
--
-- Los consentimientos se anclan a la TEMPORADA (seasons). Al iniciar una nueva
-- (finalize_active_season, C8: upcoming→active), los de la anterior dejan de ser
-- vigentes SOLOS: la query de vigencia filtra por season_id = temporada activa.
-- No se borra ni se marca nada del rollover (no se toca su lógica).
--
-- Decisiones de producto (Jose):
--   · OBLIGATORIOS (terms_conditions, privacy_policy): sin re-aceptarlos para la
--     temporada activa, el TUTOR no accede a la app (gate + pantalla).
--   · OPCIONALES (image_internal, image_social, medical_data_processing): se le
--     presentan, decide sí/no, NO bloquean el acceso.
--   · "NO" explícito a un opcional → se OCULTA (foto / médica). El dato NO se
--     borra (el borrado es F14-7).
--   · Opcional NO tocado → sigue vigente el de la temporada anterior (la LECTURA
--     no exige temporada activa; latest-wins global).
--
-- consents es un LEDGER APPEND-ONLY (F14-1): un trigger bloquea UPDATE/DELETE
-- incluso a service_role. Por eso season_id NO se backfillea por UPDATE (chocaría
-- con el trigger). La tabla está VACÍA hoy → no hay nada que backfillear. El guard
-- de abajo codifica el stop-gate: si consents tuviera filas, la migración aborta
-- con mensaje claro en vez de intentar un UPDATE que el trigger rechazaría.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. STOP-GATE: consents debe estar vacía (no hay backfill por UPDATE posible).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.consents) then
    raise exception
      'F14-5: public.consents no está vacía (% filas). season_id es NOT NULL y el backfill por UPDATE chocaría con el trigger append-only (F14-1: consents_block_update). Parar y decidir la estrategia de backfill; NO desactivar el trigger.',
      (select count(*) from public.consents)
      using errcode = 'restrict_violation';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columna season_id (NOT NULL, FK seasons). Un consentimiento sin temporada no
--    significa nada en este modelo. Tabla vacía → NOT NULL directo sin backfill.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consents
  add column season_id uuid not null references public.seasons(id);

comment on column public.consents.season_id is
  'F14-5 — temporada (seasons) a la que se ancla el consentimiento. Vigencia = última fila por (tutor, player, consent_type) CON season_id = temporada activa del club. Se sella EXPLÍCITO en cada INSERT (accept + re-consentimiento); nunca se deriva de fechas.';

-- Índice para la query de vigencia (última fila por tutor/jugador/tipo/temporada).
create index consents_season_state_idx
  on public.consents (tutor_profile_id, player_id, consent_type, season_id, accepted_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: temporada activa de un club (fuente de verdad = seasons.status).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.active_season_id(p_club_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.seasons
  where club_id = p_club_id and status = 'active'
  limit 1;
$$;

comment on function public.active_season_id(uuid) is
  'F14-5 — id de la temporada ACTIVA del club (seasons.status=active, única por club). NULL si no hay activa. Ancla de sellado de consents.';

grant execute on function public.active_season_id(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VISIBILIDAD de la FOTO (regla 4/5): se OCULTA solo con un "NO" EXPLÍCITO.
--    Sin fila de consentimiento (fotos legacy de staff, pre-F14) → VISIBLE.
--    Lectura latest-wins global (NO exige temporada activa: lo no tocado vale).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_photo_visible(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'image_internal'
    order by c.accepted_at desc
    limit 1
  ), true);
$$;

comment on function public.player_photo_visible(uuid) is
  'F14-5 — TRUE salvo que el ÚLTIMO image_internal sea granted=false (retirada explícita). Sin filas → TRUE (fotos legacy visibles). Latest-wins global (no exige temporada activa). Usado por la RLS de storage player-photos.';

grant execute on function public.player_photo_visible(uuid) to authenticated;

-- Storage player-photos: la SELECT deja de servir la foto en cuanto se retira el
-- image_internal. Único chokepoint: toda foto se muestra vía signed URL con el
-- cliente del usuario (RLS aplica) → se oculta en TODAS las superficies a la vez,
-- sin tocar queries. Se conserva el requisito de miembro del club (user_can_see_player).
drop policy "player_photos_select_member" on storage.objects;
create policy "player_photos_select_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_can_see_player(((storage.foldername(name))[1])::uuid)
    and public.player_photo_visible(((storage.foldername(name))[1])::uuid)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MÉDICA (F14-4): separar LECTURA de ESCRITURA (regla 5).
--    · LECTURA: consentimiento otorgado y NO retirado, latest-wins GLOBAL (no
--      exige temporada activa ni versión vigente: lo no tocado sigue valiendo).
--    · ESCRITURA: consentimiento otorgado para la TEMPORADA ACTIVA.
--    Default false en ambos (la médica es categoría especial: invisible/no
--    escribible sin consentimiento; preserva el comportamiento de datos migrados).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_has_medical_consent_read(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'medical_data_processing'
    order by c.accepted_at desc
    limit 1
  ), false);
$$;

comment on function public.user_has_medical_consent_read(uuid) is
  'F14-5 — LECTURA de médica: TRUE si el ÚLTIMO medical_data_processing es granted=true (latest-wins GLOBAL, sin exigir temporada activa ni versión). Regla: lo no tocado sigue valiendo. Default false.';

grant execute on function public.user_has_medical_consent_read(uuid) to authenticated;

create or replace function public.user_has_medical_consent_write(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'medical_data_processing'
      and c.season_id = public.active_season_id(
        (select club_id from public.players where id = p_player_id)
      )
    order by c.accepted_at desc
    limit 1
  ), false);
$$;

comment on function public.user_has_medical_consent_write(uuid) is
  'F14-5 — ESCRITURA de médica: TRUE si el ÚLTIMO medical_data_processing PARA LA TEMPORADA ACTIVA del club del jugador es granted=true. Default false (sin re-consentir la temporada activa no se escribe).';

grant execute on function public.user_has_medical_consent_write(uuid) to authenticated;

-- Repuntar las policies de player_medical: SELECT usa LECTURA, escritura usa ESCRITURA.
drop policy player_medical_select on public.player_medical;
create policy player_medical_select on public.player_medical
  for select to authenticated
  using (
    public.user_can_access_player_medical(player_id)
    and public.user_has_medical_consent_read(player_id)
  );

drop policy player_medical_insert_tutor on public.player_medical;
create policy player_medical_insert_tutor on public.player_medical
  for insert to authenticated
  with check (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent_write(player_id)
  );

drop policy player_medical_update_tutor on public.player_medical;
create policy player_medical_update_tutor on public.player_medical
  for update to authenticated
  using (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent_write(player_id)
  )
  with check (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent_write(player_id)
  );

drop policy player_medical_delete_tutor on public.player_medical;
create policy player_medical_delete_tutor on public.player_medical
  for delete to authenticated
  using (
    public.user_is_tutor_of_player(player_id)
    and public.user_has_medical_consent_write(player_id)
  );

-- El helper anterior (una sola noción, versión vigente) ya no lo usa nadie.
drop function if exists public.user_has_medical_consent(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Sellado de season_id en accept_pending_invitations (F14-3a/3c/4). Misma
--    firma y misma lógica de batch multi-hijo; SOLO se añade el sellado de la
--    temporada activa del club de la invitación en cada INSERT de consents.
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

  select max(version) into v_terms_version from legal_documents where doc_type = 'terms_conditions';
  select max(version) into v_privacy_version from legal_documents where doc_type = 'privacy_policy';
  select max(version) into v_img_internal_version from legal_documents where doc_type = 'image_internal';
  select max(version) into v_img_social_version from legal_documents where doc_type = 'image_social';
  select max(version) into v_med_version from legal_documents where doc_type = 'medical_informed_consent';

  -- Consentimientos de cuenta (T&C + Privacidad), una vez POR TEMPORADA.
  if v_terms_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions' and granted and season_id = v_season
     ) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_version, v_season, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy' and granted and season_id = v_season
     ) then
    if not p_accept_privacy then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_version, v_season, v_ip, p_user_agent);
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
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_internal', v_internal, v_img_internal_version, v_season, v_ip, p_user_agent);
      end if;
      if v_img_social_version is not null then
        insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
        values (v_uid, v_inv.player_id, 'image_social', v_social, v_img_social_version, v_season, v_ip, p_user_agent);
      end if;
      update players set photo_url = v_path where id = v_inv.player_id;

      -- ── F14-4 — médica (OPCIONAL, no gatea) ─────────────────────────────────
      v_med := p_medical -> v_inv.player_id::text;
      if v_med is not null and (v_med ? 'consent') and v_med_version is not null then
        v_med_consent := (v_med ->> 'consent')::boolean;
        if v_med_consent is not null then
          insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
          values (v_uid, v_inv.player_id, 'medical_data_processing', v_med_consent, v_med_version, v_season, v_ip, p_user_agent);
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
  'F14-3a/3c/4/5 — Alta multi-hijo ATÓMICA. Consentimientos de cuenta + por hijo (imagen obligatoria + médica OPCIONAL) + foto + (si consiente y aporta) fila player_medical, TODOS sellados con season_id = temporada activa del club de la invitación. Todo o nada. SECURITY DEFINER.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GATE: ¿el tutor debe re-consentir para la temporada activa? TRUE si es tutor
--    (parent/guardian) del club y le falta terms_conditions O privacy_policy
--    con granted=true para la temporada activa. El staff nunca es tutor → false.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tutor_needs_reconsent(p_club_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_season uuid;
  v_is_tutor boolean;
  v_has_terms boolean;
  v_has_privacy boolean;
begin
  if v_uid is null then
    return false;
  end if;

  -- ¿Es tutor (parent/guardian) de algún jugador de ESTE club?
  select exists (
    select 1
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    where pa.profile_id = v_uid
      and pa.relation in ('parent', 'guardian')
      and pl.club_id = p_club_id
  ) into v_is_tutor;
  if not v_is_tutor then
    return false;
  end if;

  v_season := public.active_season_id(p_club_id);
  if v_season is null then
    return false;  -- sin temporada activa no se puede exigir re-consentimiento.
  end if;

  select exists (
    select 1 from public.consents
    where tutor_profile_id = v_uid and player_id is null
      and consent_type = 'terms_conditions' and granted and season_id = v_season
  ) into v_has_terms;

  select exists (
    select 1 from public.consents
    where tutor_profile_id = v_uid and player_id is null
      and consent_type = 'privacy_policy' and granted and season_id = v_season
  ) into v_has_privacy;

  return not (v_has_terms and v_has_privacy);
end;
$$;

comment on function public.tutor_needs_reconsent(uuid) is
  'F14-5 — TRUE si el usuario es tutor (parent/guardian) del club y le falta terms_conditions o privacy_policy con granted=true para la temporada activa. Gate de acceso (obligatorios). Staff → false.';

grant execute on function public.tutor_needs_reconsent(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC de envío de la pantalla de re-consentimiento. UNA transacción, todo o
--    nada. Sella la temporada activa del club del tutor. auth.uid() DENTRO.
--    p_children = { "<player_id>": { "internal": bool?, "social": bool?, "medical": bool? } }
--    Solo las claves DECIDIDAS (no null) generan INSERT; las no tocadas se omiten.
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
  v_terms_version int;
  v_privacy_version int;
  v_img_internal_version int;
  v_img_social_version int;
  v_med_version int;
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

  select max(version) into v_terms_version from legal_documents where doc_type = 'terms_conditions';
  select max(version) into v_privacy_version from legal_documents where doc_type = 'privacy_policy';
  select max(version) into v_img_internal_version from legal_documents where doc_type = 'image_internal';
  select max(version) into v_img_social_version from legal_documents where doc_type = 'image_social';
  select max(version) into v_med_version from legal_documents where doc_type = 'medical_informed_consent';

  -- ── Obligatorios: deben aceptarse; se sellan a la temporada activa ──────────
  if v_terms_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions' and granted and season_id = v_season
     ) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_version, v_season, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy' and granted and season_id = v_season
     ) then
    if not p_accept_privacy then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_version, v_season, v_ip, p_user_agent);
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
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'image_internal', v_internal, v_img_internal_version, v_season, v_ip, p_user_agent);
    end if;

    if v_child ? 'social' and (v_child ->> 'social') is not null and v_img_social_version is not null then
      v_social := (v_child ->> 'social')::boolean;
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'image_social', v_social, v_img_social_version, v_season, v_ip, p_user_agent);
    end if;

    if v_child ? 'medical' and (v_child ->> 'medical') is not null and v_med_version is not null then
      v_medical := (v_child ->> 'medical')::boolean;
      insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, ip, user_agent)
      values (v_uid, v_pid, 'medical_data_processing', v_medical, v_med_version, v_season, v_ip, p_user_agent);
    end if;
  end loop;
end;
$$;

comment on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) is
  'F14-5 — Envío de la pantalla de re-consentimiento. Sella los OBLIGATORIOS (granted=true) y los OPCIONALES DECIDIDOS (granted=decisión) a la temporada activa del club del tutor, en UNA transacción. Los opcionales no tocados no se insertan (sigue vigente el de la temporada anterior). SECURITY DEFINER, auth.uid() interno.';

revoke all on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) from public;
grant execute on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) to authenticated;
