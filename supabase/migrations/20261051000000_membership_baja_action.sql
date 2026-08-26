-- Baja de miembros · Paso 4a+4b — LA ACCIÓN.
--
-- Sobre 20261049 (columna memberships.left_at) y 20261050 (enforcement en helpers/RLS).
-- Este paso añade la ACCIÓN de dar de baja/reactivar y arregla un bug silencioso vivo
-- del re-invite. Cero cambios de esquema: solo dos funciones.
--
--  4a · set_membership_left(club, target, left_at, reason) — nueva RPC. Da de baja
--       (left_at no nulo) o reactiva (NULL → limpia la razón). Idempotente. La RAZÓN
--       es NOTA INTERNA: nunca se muestra al afectado. Autorización (A2):
--         · Caller: admin_club o director ACTIVOS del club, o superadmin.
--         · admin_immutable: al admin_club NO se le da de baja (traspasar antes la
--           administración) — coherente con memberships_one_admin_per_club.
--         · cannot_leave_self: nadie se da de baja a sí mismo.
--         · forbidden_requires_admin: sobre un rol ALTO (director) solo puede admin_club
--           (o superadmin); un director NO puede con otro director.
--       Solo toca left_at/left_reason: nunca role, team_* ni histórico. memberships no
--       tiene updated_at (a diferencia de set_player_left_club), así que no se sella.
--
--  4b · accept_pending_invitations — recreada VERBATIM desde su definición viva, con un
--       ÚNICO cambio: el ON CONFLICT de la membership pasa de `do nothing` a `do update`.
--       Motivo (BUG SILENCIOSO): con `do nothing`, re-invitar a alguien de baja dejaba
--       su fila intacta (left_at seguía no nulo) → seguía bloqueado pese a "aceptar".
--       El nuevo ON CONFLICT reactiva (left_at/left_reason → NULL) y decide el rol con
--       un CASE que discrimina por left_at:
--         · Estaba DE BAJA (left_at not null) → adopta el rol de la invitación
--           (excluded.role): reincorporarse = alta nueva, con el rol que eligió quien
--           invita.
--         · Estaba ACTIVO (left_at null) → conserva su rol actual (memberships.role):
--           una invitación de entrenador a un director NO lo degrada.
--       Las otras dos ramas ON CONFLICT DO NOTHING (seguidor player_spectators,
--       player_accounts) quedan INTACTAS. Ramas raise exception: sin cambios.
--       Si la invitación reincorpora como admin_club y ya hay admin, el excluded.role
--       choca con memberships_one_admin_per_club → unique_violation. Correcto (no puede
--       haber dos admin); no se tapa.
--
-- La suite pgTAP (11 casos, P0–P10) vive en supabase/tests/membership_baja_action.sql
-- (convención del repo: begin/rollback; una migración aplicada a prod no lleva bloques
-- de test reversibles). Se entrega en el mismo PR, como en el paso 2.

-- ═══════════ 4a · set_membership_left ═══════════
create or replace function public.set_membership_left(
  p_club_id uuid, p_target_profile_id uuid, p_left_at date, p_reason text
) returns date language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;

  -- Caller: admin_club o director del club (ACTIVO), o superadmin (A2, patrón admin_update_staff_role).
  select m.role into v_caller_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = v_uid and m.left_at is null;
  if not public.is_superadmin()
     and (v_caller_role is null or v_caller_role not in ('admin_club','director')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Guarda: nadie se da de baja a sí mismo.
  if p_target_profile_id = v_uid then
    raise exception 'cannot_leave_self' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club.
  select m.role into v_target_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = p_target_profile_id;
  if v_target_role is null then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  -- Guarda DURA: el admin_club NO se da de baja (traspasar la administración antes).
  if v_target_role = 'admin_club' then
    raise exception 'admin_immutable' using errcode = 'P0001';
  end if;

  -- A2: un DIRECTOR no puede dar de baja a un rol ALTO (otro director). Solo admin_club
  -- (o superadmin) puede sobre un director. El admin ya quedó cubierto arriba.
  if public.membership_role_is_high(v_target_role)
     and not (public.is_superadmin() or v_caller_role = 'admin_club') then
    raise exception 'forbidden_requires_admin' using errcode = 'P0001';
  end if;

  -- Baja (left_at no nulo) o reactivar (NULL → limpia la razón). Idempotente. Solo estas
  -- dos columnas: nunca role/team_*/histórico.
  update public.memberships
     set left_at = p_left_at,
         left_reason = case when p_left_at is null then null else p_reason end
   where club_id = p_club_id and profile_id = p_target_profile_id;

  return p_left_at;
end;
$fn$;

comment on function public.set_membership_left(uuid, uuid, date, text) is
  'Baja de miembros (Paso 4a). Da de baja (left_at no nulo) o reactiva (NULL) una membership. Autorización A2: admin_club/director activos o superadmin; guardas admin_immutable/cannot_leave_self/forbidden_requires_admin. La razón es nota interna, nunca visible al afectado. No toca role ni histórico.';

-- ═══════════ 4b · accept_pending_invitations (VERBATIM del vivo, único cambio: ON CONFLICT) ═══════════
CREATE OR REPLACE FUNCTION public.accept_pending_invitations(p_clicked_token uuid, p_accept_terms boolean DEFAULT false, p_accept_privacy boolean DEFAULT false, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_children jsonb DEFAULT '{}'::jsonb, p_medical jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- Baja de miembros (Paso 4b) — ON CONFLICT reactiva en vez de ignorar. Un re-invite a
    -- alguien DE BAJA lo reincorpora (left_at/left_reason → NULL) adoptando el rol de la
    -- invitación; a un miembro ACTIVO no le cambia el rol. Discrimina por left_at (CASE).
    insert into memberships (profile_id, club_id, role)
    values (v_uid, v_inv.club_id, v_inv.role)
    on conflict (profile_id, club_id) do update
      set left_at     = null,
          left_reason = null,
          role = case
                   when memberships.left_at is not null then excluded.role
                   else memberships.role
                 end;

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
$function$;
