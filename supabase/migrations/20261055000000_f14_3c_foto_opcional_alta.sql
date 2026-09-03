-- F14-3c (revisión) — La FOTO deja de ser obligatoria en el alta.
--
-- DECISIÓN DE JOSE: un padre completa el alta sin subir ninguna foto. Y si dice
-- NO al uso de la imagen dentro de la app, el formulario ni siquiera se la pide.
--
-- POR QUÉ, más allá de la molestia: hoy, cuando la familia responde NO a la
-- imagen interna, el alta le exige un "avatar" igualmente. Ese fichero se guarda
-- y la RLS de storage (`player_photos_select_member` exige `player_photo_visible`,
-- que devuelve false con la interna revocada) hace que NADIE pueda verlo jamás.
-- Es una imagen de un menor retenida sin uso posible. En producción no hay
-- ninguna todavía —nadie ha dicho que no— y por eso esto se cierra antes.
--
-- LO QUE NO CAMBIA: las DOS decisiones de imagen (interna / redes) siguen siendo
-- OBLIGATORIAS por hijo. Son el consentimiento RGPD; la foto no lo es.
--
-- CUATRO CAMBIOS, y ninguno más, sobre la definición VIVA (`pg_get_functiondef`,
-- no la migración: F14-14 fue revertida y las migraciones no son la verdad):
--
--   1. Hijo del lote sin entrada en `p_children` → `image_decision_required` en
--      vez de `image_required`. Lo que falta son las decisiones, no la imagen;
--      el mensaje que veía el usuario engañaba.
--   2. `v_path` se normaliza con nullif(btrim(...)): ausente o en blanco = no hay
--      foto, que ahora es un caso VÁLIDO.
--   3. El guard de carpeta se conserva para cuando SÍ viene path: sigue siendo
--      imposible escribir en la carpeta de otro jugador (`image_required`).
--   4. `update players set photo_url` pasa a ser CONDICIONAL. Antes era
--      incondicional: un jugador con foto previa (subida desde su ficha) la
--      PERDERÍA al aceptar una invitación sin subir ninguna. Verificado contra
--      producción aplicando una variante sin este guard: photo_url quedaba NULL.
--      El ORDEN CRÍTICO de F14-3c se mantiene — el UPDATE va DESPUÉS del insert
--      en player_accounts, para que `players_guard_photo_url` pase por la rama
--      del TUTOR. Por eso NO se toca el trigger.
--
-- La FIRMA NO CAMBIA (`create or replace`, sin drop). Eso es lo que permite
-- aplicarla ANTES del deploy: la web de hoy siempre manda path y esta versión lo
-- sigue aceptando. ESE ORDEN ES OBLIGATORIO — migración primero, deploy después.
-- Al revés, la web nueva mandaría hijos sin path contra la RPC vieja y tumbaría
-- altas en producción.
--
-- Ensayo BEGIN...ROLLBACK contra producción, seis casos: alta sin foto; alta
-- diciendo NO; sin decisiones → image_decision_required; path de otra carpeta →
-- image_required; jugador con foto previa que la CONSERVA; y un lote de dos
-- hijos, uno con foto y otro sin ella, aceptado entero.
-- Cobertura: supabase/tests/accept_invitation_foto_opcional.sql

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

    -- ── F14-3c — decisiones de imagen (OBLIGATORIAS) + foto (OPCIONAL) ─────────
    -- Las dos decisiones son el CONSENTIMIENTO y siguen siendo obligatorias. La
    -- foto ya no: un padre completa el alta sin subir ninguna.
    if v_inv.role = 'jugador' and v_inv.player_id is not null then
      v_batch_players := v_batch_players || v_inv.player_id::text;
      v_child := p_children -> v_inv.player_id::text;
      -- Sin entrada del hijo lo que falta son las DECISIONES, no la imagen.
      if v_child is null then raise exception 'image_decision_required'; end if;
      v_internal := (v_child ->> 'internal')::boolean;
      v_social := (v_child ->> 'social')::boolean;
      -- Path ausente o en blanco = no hay foto, que ahora es un caso válido.
      v_path := nullif(btrim(coalesce(v_child ->> 'path', '')), '');
      if v_internal is null or v_social is null then raise exception 'image_decision_required'; end if;
      -- El guard de carpeta se queda para cuando SÍ viene path: nadie escribe en
      -- la carpeta de otro jugador.
      if v_path is not null and v_path not like (v_inv.player_id::text || '/%') then
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
      -- Solo si hay foto nueva. INCONDICIONAL borraría la que ya tuviera el
      -- jugador (subida antes desde la ficha) al aceptar sin subir ninguna.
      -- ORDEN CRÍTICO intacto: va DESPUÉS del insert en player_accounts, para
      -- que players_guard_photo_url pase por la rama del TUTOR (F14-3c).
      if v_path is not null then
        update players set photo_url = v_path where id = v_inv.player_id;
      end if;

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
$function$

;
