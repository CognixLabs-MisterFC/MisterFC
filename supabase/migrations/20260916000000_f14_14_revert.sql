-- REVERSIÓN de 20260915000000 (#308 "F14-14"): deshace una feature de re-firma
-- selectiva que reescribió funciones CERRADAS de F14-5 sin diseño ni aprobación.
-- Reversión HACIA ADELANTE (no se edita la migración ya aplicada).
--
-- Qué deshace:
--   1. tutor_needs_reconsent → EXACTA de F14-5 (20260910000000), sin depender de
--      tutor_pending_reconsent_docs.
--   2. record_season_reconsent → EXACTA de F14-11/12 / #307 (20260914000000):
--      conserva el filtro por club y el sellado de legal_document_id; el guard de
--      los obligatorios vuelve a "no existe consent granted de la temporada activa".
--   3. DROP de la función nueva tutor_pending_reconsent_docs.
--   4. DROP de la columna legal_documents.requires_resignature (10 filas en false,
--      sin lectores fuera de #308).
--
-- Qué se CONSERVA (no lo toca #308 ni esta reversión): los 10 registros de
-- legal_documents (v1 placeholder + v2 real de cada doc_type), el esquema por club
-- de F14-11/12, y la idempotencia del script de carga (vive solo en el .mjs).
--
-- ORDEN: primero se recrean las dos funciones a su versión de main (ya no llaman a
-- tutor_pending_reconsent_docs), LUEGO se dropea esa función, y por último la
-- columna (que solo leía la función dropeada).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tutor_needs_reconsent → definición EXACTA de F14-5 (20260910000000).
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
-- 2. record_season_reconsent → definición EXACTA de F14-11/12 / #307
--    (20260914000000). Filtra por club + sella legal_document_id; guard de
--    obligatorios = "no existe consent granted de la temporada activa".
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DROP de la función nueva de #308 (ya no la llama nadie tras el paso 1-2).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.tutor_pending_reconsent_docs(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DROP de la columna de #308 (solo la leía la función ya dropeada).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.legal_documents drop column if exists requires_resignature;
