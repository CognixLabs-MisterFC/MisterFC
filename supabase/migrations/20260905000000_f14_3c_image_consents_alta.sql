-- F14-3c — Consentimientos de IMAGEN por hijo + foto obligatoria, DENTRO del alta.
--
-- Extiende accept_pending_invitations (F14-3a) para recibir, por hijo pendiente,
-- las dos decisiones de imagen (interna / redes) y el PATH de su imagen ya subida
-- al bucket (server-side con admin, antes de llamar). En la MISMA transacción:
--   · INSERT en consents: image_internal (granted=decisión) + image_social
--     (granted=decisión), player_id=el hijo, versión vigente, ip, user_agent.
--   · players.photo_url = path del hijo.
--
-- ORDEN CRÍTICO (verificado empíricamente): el UPDATE de photo_url va DESPUÉS del
-- INSERT en player_accounts. Dentro de un SECURITY DEFINER, current_user es el
-- OWNER (postgres) y auth.uid() es el PADRE (no null) → la exención de
-- service_role del trigger players_guard_photo_url (F14-3b, que exime cuando
-- auth.uid() es null) NO aplica aquí. Pasa por la rama del TUTOR: con el vínculo
-- player_accounts ya insertado, user_is_tutor_of_player() es true y el trigger lo
-- permite. Por eso NO se toca el trigger.
--
-- Gating server-side: cada hijo pendiente (jugador con player_id) DEBE traer las
-- dos decisiones (no null) y un path. Falta algo → RAISE → revierte todo. Un
-- player_id fuera del lote → RAISE. Todo o nada, como 3a.

-- La firma cambia (nuevo p_children jsonb) → DROP + CREATE.
drop function if exists public.accept_pending_invitations(uuid, boolean, boolean, text, text);

create function public.accept_pending_invitations(
  p_clicked_token uuid,
  p_accept_terms boolean default false,
  p_accept_privacy boolean default false,
  p_ip text default null,
  p_user_agent text default null,
  p_children jsonb default '{}'::jsonb
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
  v_ip inet;
  v_inv record;
  v_membership_id uuid;
  v_processed int := 0;
  v_batch_players text[] := '{}';
  v_child jsonb;
  v_internal boolean;
  v_social boolean;
  v_path text;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Serializa submits concurrentes del mismo usuario.
  perform pg_advisory_xact_lock(hashtext('accept_pending:' || v_uid::text));

  select email into v_email from auth.users where id = v_uid;

  select email, club_id into v_anchor_email, v_anchor_club
  from invitations
  where token = p_clicked_token;
  if not found then
    raise exception 'not_found';
  end if;

  -- GUARD: auth.uid() debe corresponder al email de esa invitación.
  if v_email is null
     or lower(btrim(v_email)) <> lower(btrim(v_anchor_email)) then
    raise exception 'wrong_email';
  end if;

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Versiones vigentes de todos los documentos legales implicados.
  select max(version) into v_terms_version from legal_documents where doc_type = 'terms_conditions';
  select max(version) into v_privacy_version from legal_documents where doc_type = 'privacy_policy';
  select max(version) into v_img_internal_version from legal_documents where doc_type = 'image_internal';
  select max(version) into v_img_social_version from legal_documents where doc_type = 'image_social';

  -- ── Consentimientos de cuenta (T&C + Privacidad), una vez (F14-2/3a) ──────────
  if v_terms_version is not null
     and not exists (
       select 1 from consents
       where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions' and granted
         and legal_document_version = v_terms_version
     ) then
    if not p_accept_terms then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_version, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents
       where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy' and granted
         and legal_document_version = v_privacy_version
     ) then
    if not p_accept_privacy then raise exception 'consent_required'; end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_version, v_ip, p_user_agent);
  end if;

  -- ── Lote: todas las pendientes de ese email en ESE club (FOR UPDATE) ──────────
  for v_inv in
    select * from invitations
    where lower(btrim(email)) = lower(btrim(v_anchor_email))
      and club_id = v_anchor_club
      and accepted_at is null
      and expires_at > now()
    order by created_at
    for update
  loop
    -- membership (idempotente)
    insert into memberships (profile_id, club_id, role)
    values (v_uid, v_inv.club_id, v_inv.role)
    on conflict (profile_id, club_id) do nothing;

    select id into v_membership_id
    from memberships where profile_id = v_uid and club_id = v_inv.club_id;

    -- vínculo tutor↔jugador (idempotente) — DEBE ir ANTES del photo_url.
    if v_inv.role = 'jugador'
       and v_inv.player_id is not null
       and v_inv.player_relation is not null then
      insert into player_accounts (player_id, profile_id, relation)
      values (v_inv.player_id, v_uid, v_inv.player_relation)
      on conflict (player_id, profile_id) do nothing;
    end if;

    -- team_staff (solo invitaciones de staff)
    if v_inv.team_id is not null
       and v_inv.team_staff_role is not null
       and v_membership_id is not null then
      begin
        insert into team_staff (team_id, membership_id, staff_role)
        values (v_inv.team_id, v_membership_id, v_inv.team_staff_role);
      exception when unique_violation then
        null;
      end;
    end if;

    -- ── F14-3c — decisiones de imagen + foto obligatoria (solo hijos) ───────────
    if v_inv.role = 'jugador' and v_inv.player_id is not null then
      v_batch_players := v_batch_players || v_inv.player_id::text;
      v_child := p_children -> v_inv.player_id::text;
      if v_child is null then
        raise exception 'image_required';
      end if;
      v_internal := (v_child ->> 'internal')::boolean;
      v_social := (v_child ->> 'social')::boolean;
      v_path := v_child ->> 'path';
      -- Ambas decisiones explícitas (sí/no), no ausentes.
      if v_internal is null or v_social is null then
        raise exception 'image_decision_required';
      end if;
      -- Imagen obligatoria en ambos casos; el path debe ser de la carpeta del hijo.
      if v_path is null or btrim(v_path) = ''
         or v_path not like (v_inv.player_id::text || '/%') then
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

      -- photo_url DESPUÉS del vínculo → trigger permite por la rama del tutor.
      update players set photo_url = v_path where id = v_inv.player_id;
    end if;

    -- mark-accepted single-use
    update invitations set accepted_at = now()
    where id = v_inv.id and accepted_at is null;

    v_processed := v_processed + 1;
  end loop;

  -- Guard: ningún player_id de p_children puede caer fuera del lote.
  if exists (
    select 1 from jsonb_object_keys(p_children) as k
    where not (k = any (v_batch_players))
  ) then
    raise exception 'player_not_in_batch';
  end if;

  return v_processed;
end;
$$;

comment on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb) is
  'F14-3a/3c — Alta multi-hijo ATÓMICA. Valida auth.uid()=email del token, registra consentimientos de cuenta (T&C+Privacidad) y por hijo los de imagen (interna/redes, granted=decisión) + fija players.photo_url (obligatoria). Procesa TODAS las pendientes del email en ese club (membership + player_accounts + team_staff + mark-accepted). p_children = {player_id: {internal,social,path}}. Todo o nada. SECURITY DEFINER.';

revoke all on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb) from public;
grant execute on function public.accept_pending_invitations(uuid, boolean, boolean, text, text, jsonb) to authenticated;
