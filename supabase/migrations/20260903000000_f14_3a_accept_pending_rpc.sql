-- F14-3a — Alta MULTI-HIJO ATÓMICA (todo o nada).
--
-- Sustituye la orquestación en Node (bucle no atómico: si fallaba el hijo 2 de 3,
-- 1 y 3 quedaban persistidos) por UNA RPC SECURITY DEFINER = UNA transacción de
-- Postgres. O se procesan TODAS las invitaciones pendientes del lote (+ los
-- consentimientos de cuenta) o no se persiste NINGUNA.
--
-- Ancla del lote = la invitación del token clicado: su email y su club_id. El
-- GUARD vive DENTRO de la función (no se confía en ningún email por parámetro):
-- se compara el email autenticado (auth.users, no el claim del JWT) con el de esa
-- invitación. SECURITY DEFINER bypassa RLS, así que el guard ES la frontera de
-- seguridad.
--
-- Idempotencia por fila (ON CONFLICT DO NOTHING / mark-accepted single-use) para
-- tolerar el doble submit, pero un fallo REAL en cualquier fila hace RAISE y
-- revierte TODO el lote. Un advisory lock por usuario serializa submits
-- concurrentes (evita consents duplicados en la ventana previa al bucle).
--
-- consents: el trigger append-only (F14-1) solo bloquea UPDATE/DELETE; aquí solo
-- se INSERTA, y un ROLLBACK de transacción NO es un DELETE, así que no lo dispara.

create or replace function public.accept_pending_invitations(
  p_clicked_token uuid,
  p_accept_terms boolean default false,
  p_accept_privacy boolean default false,
  p_ip text default null,
  p_user_agent text default null
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
  v_ip inet;
  v_inv record;
  v_membership_id uuid;
  v_processed int := 0;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Serializa submits concurrentes del mismo usuario (auto-liberado al commit/rollback).
  perform pg_advisory_xact_lock(hashtext('accept_pending:' || v_uid::text));

  -- Email autenticado REAL (auth.users, no el claim del JWT).
  select email into v_email from auth.users where id = v_uid;

  -- Ancla del lote = invitación del token clicado.
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

  -- ip textual → inet defensivo (un valor raro no debe abortar un alta legal).
  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- ── Consentimientos de cuenta (T&C + Privacidad) en la MISMA transacción ──
  select max(version) into v_terms_version
  from legal_documents where doc_type = 'terms_conditions';
  select max(version) into v_privacy_version
  from legal_documents where doc_type = 'privacy_policy';

  if v_terms_version is not null
     and not exists (
       select 1 from consents
       where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'terms_conditions'
         and granted and legal_document_version = v_terms_version
     ) then
    if not p_accept_terms then
      raise exception 'consent_required';
    end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'terms_conditions', true, v_terms_version, v_ip, p_user_agent);
  end if;

  if v_privacy_version is not null
     and not exists (
       select 1 from consents
       where tutor_profile_id = v_uid and player_id is null
         and consent_type = 'privacy_policy'
         and granted and legal_document_version = v_privacy_version
     ) then
    if not p_accept_privacy then
      raise exception 'consent_required';
    end if;
    insert into consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, ip, user_agent)
    values (v_uid, null, 'privacy_policy', true, v_privacy_version, v_ip, p_user_agent);
  end if;

  -- ── Lote: todas las pendientes de ese email en ESE club ──────────────────────
  -- FOR UPDATE bloquea las filas: un submit concurrente re-evalúa tras el commit
  -- y ya no las ve pendientes (no reprocesa).
  for v_inv in
    select * from invitations
    where lower(btrim(email)) = lower(btrim(v_anchor_email))
      and club_id = v_anchor_club
      and accepted_at is null
      and expires_at > now()
    order by created_at
    for update
  loop
    -- membership (idempotente por unique(profile_id, club_id))
    insert into memberships (profile_id, club_id, role)
    values (v_uid, v_inv.club_id, v_inv.role)
    on conflict (profile_id, club_id) do nothing;

    select id into v_membership_id
    from memberships where profile_id = v_uid and club_id = v_inv.club_id;

    -- vínculo tutor↔jugador (idempotente por unique(player_id, profile_id))
    if v_inv.role = 'jugador'
       and v_inv.player_id is not null
       and v_inv.player_relation is not null then
      insert into player_accounts (player_id, profile_id, relation)
      values (v_inv.player_id, v_uid, v_inv.player_relation)
      on conflict (player_id, profile_id) do nothing;
    end if;

    -- team_staff (solo invitaciones de staff). Tolera duplicado (doble submit);
    -- un error real (FK, etc.) se propaga y revierte todo.
    if v_inv.team_id is not null
       and v_inv.team_staff_role is not null
       and v_membership_id is not null then
      begin
        insert into team_staff (team_id, membership_id, staff_role)
        values (v_inv.team_id, v_membership_id, v_inv.team_staff_role);
      exception when unique_violation then
        null; -- ya era staff activo de ese equipo
      end;
    end if;

    -- mark-accepted single-use
    update invitations set accepted_at = now()
    where id = v_inv.id and accepted_at is null;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

comment on function public.accept_pending_invitations(uuid, boolean, boolean, text, text) is
  'F14-3a — Alta multi-hijo ATÓMICA. En una transacción: valida que auth.uid() = email de la invitación del token, registra consentimientos de cuenta (T&C+Privacidad) y procesa TODAS las invitaciones pendientes de ese email en ese club (membership + player_accounts + team_staff + mark-accepted). Todo o nada. SECURITY DEFINER: el guard interno es la frontera de seguridad. Devuelve nº de invitaciones procesadas.';

-- Solo el invitee autenticado la invoca; el guard interno hace el resto.
revoke all on function public.accept_pending_invitations(uuid, boolean, boolean, text, text) from public;
grant execute on function public.accept_pending_invitations(uuid, boolean, boolean, text, text) to authenticated;
