-- F14-14 — PUBLICACIÓN DE TEXTOS LEGALES: re-firma selectiva mitad de temporada.
--
-- Dos problemas que cierra:
--   A) El script de carga NO era idempotente (max(version)+1 incondicional). La
--      idempotencia real vive en el script (comparar el body con el vigente); la
--      parte de BD es solo dar soporte a la marca de re-firma.
--   B) Publicar una versión nueva NO avisaba a nadie: el re-consentimiento solo se
--      disparaba al cambiar de temporada (F14-5). Si la ley cambia a mitad de
--      temporada, los tutores seguían con la versión antigua hasta agosto.
--
-- Decisiones de producto (Jose):
--   1. Al publicar se marca si el cambio EXIGE NUEVA FIRMA:
--        · MENOR (errata) → requires_resignature=false: nadie re-firma; los
--          consentimientos vigentes valen hasta la renovación de temporada.
--        · SUSTANCIAL → requires_resignature=true: los tutores caen en la pantalla
--          de re-consentimiento la próxima vez que entren, aunque sea mitad de
--          temporada.
--   2. La re-firma es SELECTIVA: solo el doc_type que cambió, no los cinco.
--   3. Bloqueo (igual que F14-5):
--        · OBLIGATORIO (terms_conditions, privacy_policy) que exige re-firma →
--          el tutor NO accede a la app hasta firmarlo (gate).
--        · OPCIONAL (image_internal, image_social, medical_informed_consent) →
--          se le presenta, decide sí/no, pero NO bloquea el acceso.
--
-- Modelo: "un tutor necesita re-consentir un doc_type" si
--   (i)  no tiene consent granted de la TEMPORADA ACTIVA para ese doc_type, O
--   (ii) el documento VIGENTE de ese doc_type tiene requires_resignature=true y el
--        ÚLTIMO consent del tutor para ese doc_type NO apunta a ese
--        legal_document_id (FK de F14-11/12; no el entero de versión).
-- (i) cubre el rollover de temporada (F14-5, re-consentimiento COMPLETO). (ii)
-- cubre el cambio sustancial a mitad de temporada (selectivo). El GATE solo cuenta
-- los OBLIGATORIOS; los opcionales nunca bloquean.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Marca de re-firma en legal_documents. Filas existentes → false (no disparan).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.legal_documents
  add column requires_resignature boolean not null default false;

comment on column public.legal_documents.requires_resignature is
  'F14-14 — TRUE si publicar ESTA versión exige a los tutores re-firmar el doc_type (cambio sustancial). FALSE (default) = cambio menor: los consentimientos vigentes siguen valiendo hasta la renovación de temporada. Lo consume tutor_pending_reconsent_docs / tutor_needs_reconsent (criterio ii).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: QUÉ doc_types debe (re)firmar el tutor en el club, no un booleano.
--    La pantalla lo necesita para pedir SOLO esos (regla 2/3). Devuelve el set de
--    doc_types pendientes (obligatorios cuenta-nivel + opcionales por hijo).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tutor_pending_reconsent_docs(p_club_id uuid)
returns setof public.legal_document_type
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_season uuid;
begin
  if v_uid is null then
    return;
  end if;

  -- ¿Es tutor (parent/guardian) de algún jugador de ESTE club? Staff → vacío.
  if not exists (
    select 1
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    where pa.profile_id = v_uid
      and pa.relation in ('parent', 'guardian')
      and pl.club_id = p_club_id
  ) then
    return;
  end if;

  v_season := public.active_season_id(p_club_id);
  if v_season is null then
    return;  -- sin temporada activa no se puede exigir re-consentimiento.
  end if;

  return query
  -- Documento VIGENTE (max version) por doc_type del club: id + marca de re-firma.
  with cur as (
    select distinct on (ld.doc_type)
           ld.doc_type, ld.id as doc_id, ld.requires_resignature
    from public.legal_documents ld
    where ld.club_id = p_club_id
    order by ld.doc_type, ld.version desc
  ),
  -- Hijos (parent/guardian) del tutor en el club.
  kids as (
    select distinct pa.player_id
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    where pa.profile_id = v_uid
      and pa.relation in ('parent', 'guardian')
      and pl.club_id = p_club_id
  )
  -- ── OBLIGATORIOS: cuenta-nivel (player_id NULL); consent_type = doc_type ──────
  select cur.doc_type
  from cur
  where cur.doc_type in ('terms_conditions', 'privacy_policy')
    and (
      -- (i) sin consent otorgado de la temporada activa
      not exists (
        select 1 from public.consents c
        where c.tutor_profile_id = v_uid and c.player_id is null
          and c.consent_type = cur.doc_type::text::public.consent_type
          and c.granted and c.season_id = v_season
      )
      or (
        -- (ii) el vigente exige re-firma y el último consent no apunta a él
        cur.requires_resignature and coalesce((
          select c.legal_document_id from public.consents c
          where c.tutor_profile_id = v_uid and c.player_id is null
            and c.consent_type = cur.doc_type::text::public.consent_type
          order by c.accepted_at desc
          limit 1
        ), '00000000-0000-0000-0000-000000000000'::uuid) is distinct from cur.doc_id
      )
    )

  union

  -- ── OPCIONALES: por hijo; consent_type mapeado (médico difiere del doc_type) ──
  select cur.doc_type
  from cur
  where cur.doc_type in ('image_internal', 'image_social', 'medical_informed_consent')
    and exists (
      select 1 from kids k
      where
        -- (i) sin decisión (cualquier granted) de la temporada activa para el hijo
        not exists (
          select 1 from public.consents c
          where c.tutor_profile_id = v_uid and c.player_id = k.player_id
            and c.consent_type = case cur.doc_type
                                   when 'medical_informed_consent'
                                     then 'medical_data_processing'::public.consent_type
                                   else cur.doc_type::text::public.consent_type
                                 end
            and c.season_id = v_season
        )
        or (
          -- (ii) el vigente exige re-firma y el último consent del hijo no apunta a él
          cur.requires_resignature and coalesce((
            select c.legal_document_id from public.consents c
            where c.tutor_profile_id = v_uid and c.player_id = k.player_id
              and c.consent_type = case cur.doc_type
                                     when 'medical_informed_consent'
                                       then 'medical_data_processing'::public.consent_type
                                     else cur.doc_type::text::public.consent_type
                                   end
            order by c.accepted_at desc
            limit 1
          ), '00000000-0000-0000-0000-000000000000'::uuid) is distinct from cur.doc_id
        )
    );
end;
$$;

comment on function public.tutor_pending_reconsent_docs(uuid) is
  'F14-14 — doc_types que el tutor debe (re)firmar en el club: obligatorios (cuenta-nivel) + opcionales (por hijo). Criterio (i) sin consent de la temporada activa O (ii) el vigente exige re-firma y el último consent no apunta a su legal_document_id. Vacío si no es tutor / sin temporada activa. La pantalla pide SOLO estos.';

grant execute on function public.tutor_pending_reconsent_docs(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GATE (F14-5): TRUE solo si algún OBLIGATORIO está pendiente. Los opcionales
--    nunca bloquean (regla 3). Reusa el helper anterior: una sola fuente de verdad.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tutor_needs_reconsent(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tutor_pending_reconsent_docs(p_club_id) d
    where d in ('terms_conditions', 'privacy_policy')
  );
$$;

comment on function public.tutor_needs_reconsent(uuid) is
  'F14-5/14 — TRUE si el tutor tiene algún OBLIGATORIO (terms_conditions/privacy_policy) pendiente de (re)firma para la temporada activa del club (rollover o cambio sustancial mitad de temporada). Gate de acceso. Staff / no-tutor / sin temporada → false. Los opcionales NO bloquean.';

grant execute on function public.tutor_needs_reconsent(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. record_season_reconsent (F14-5/9/14): el guard de los OBLIGATORIOS deja de
--    ser "no hay consent de la temporada" y pasa a "está pendiente" (incluye la
--    re-firma sustancial mitad de temporada). Así un privacy_policy con
--    requires_resignature=true se vuelve a insertar aunque ya hubiera un consent de
--    la temporada apuntando a la versión anterior. Los opcionales siguen igual:
--    solo se inserta lo DECIDIDO, anclado al legal_document_id vigente del club.
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
  v_pending public.legal_document_type[];
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

  -- F14-14 — qué doc_types están pendientes AHORA (antes de insertar). Única
  -- fuente de verdad para exigir/insertar los obligatorios.
  select coalesce(array_agg(d), '{}') into v_pending
  from public.tutor_pending_reconsent_docs(p_club_id) d;

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

  -- ── Obligatorios: si están PENDIENTES deben aceptarse; se sellan a la activa ──
  if v_terms_version is not null and ('terms_conditions' = any (v_pending)) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_id, v_terms_version, v_season, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null and ('privacy_policy' = any (v_pending)) then
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
  'F14-5/9/14 — Envío de la pantalla de re-consentimiento. Sella los OBLIGATORIOS PENDIENTES (rollover o re-firma sustancial) y los OPCIONALES DECIDIDOS a la temporada activa y al legal_document_id VIGENTE del club, en UNA transacción. SECURITY DEFINER, auth.uid() interno.';

revoke all on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) from public;
grant execute on function public.record_season_reconsent(uuid, boolean, boolean, text, text, jsonb) to authenticated;
