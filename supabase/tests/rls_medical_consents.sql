-- F15-C1 — Datos médicos del menor (RGPD art. 9) + consentimientos.
--
-- ⚠️ La médica se lee/escribe SOLO por las RPC get_player_medical /
-- set_player_medical (player_medical está CERRADA: RLS on, 0 policies,
-- privilegios revocados). NO se usa user_can_see_player_medical (helper LEGACY
-- MUERTO, 0 referencias vivas). El forjado de consentimientos ya lo cubre
-- rls_consents_forge_gate.sql (F15-C0 #370); aquí no se duplica.
--
-- LECTURA  (get_player_medical = user_can_access_player_medical AND user_has_medical_consent_read):
--   L1  staff del equipo, CON consentimiento            → ve
--   L2  staff del equipo, SIN consentimiento            → forbidden
--   L3  staff del equipo, consentimiento RETIRADO       → forbidden (latest-wins)
--   L4  staff de OTRO equipo del club (con consent)     → forbidden (gate por EQUIPO)
--   L5  staff de OTRO club                              → forbidden
--   L6  admin y director SIN consentimiento             → forbidden (aplica a dirección)
--   L7  admin y director CON consentimiento             → ve
--   L8  tutor → ve su hijo; hijo ajeno                  → forbidden
--   L9  jugador sin vínculo / seguidor / coordinador ajeno al equipo → forbidden
--   L10 staff que PROMOCIONA al jugador, con consent    → ve
-- ESCRITURA (set_player_medical = user_is_tutor_of_player AND user_has_medical_consent_write[activa]):
--   E1  staff (no tutor)                                → forbidden
--   E2  tutor SIN consent de la TEMPORADA ACTIVA        → forbidden (write season-scoped)
--   E3  tutor CON consent de temporada activa           → escribe
-- APPEND-ONLY / CIERRE:
--   T1  service_role NO puede UPDATE/DELETE consents    (triggers append-only)
--   T2  authenticated: SELECT/INSERT/UPDATE directo player_medical → denegado
-- AISLAMIENTO:
--   C1  tutor A no ve los consents de tutor B           (consents_select_own)
--   C2  usuario del club X no ve legal_documents del club Y (per-club)
\ir helpers/auth_users.sql

begin;

-- ── Helpers de aserción (cambian de rol/sujeto internamente, como F2.2) ─────────
create or replace function pg_temp.set_auth(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- get_player_medical debe DEVOLVER la alergia esperada (ve).
create or replace function pg_temp.assert_reads(
  p_label text, p_sub text, p_player uuid, p_expected text
) returns void language plpgsql as $$
declare v text;
begin
  perform pg_temp.set_auth(p_sub);
  select allergies into v from public.get_player_medical(p_player);
  if v is distinct from p_expected then
    raise exception 'FAIL [%]: esperaba ver "%", get_player_medical devolvió "%"',
      p_label, p_expected, coalesce(v, 'NULL/forbidden');
  end if;
end $$;

-- get_player_medical debe lanzar 'forbidden' (no ve).
create or replace function pg_temp.assert_forbidden(
  p_label text, p_sub text, p_player uuid
) returns void language plpgsql as $$
declare v_returned boolean := false;
begin
  perform pg_temp.set_auth(p_sub);
  begin
    perform allergies from public.get_player_medical(p_player);
    v_returned := true;
  exception when others then
    if sqlerrm <> 'forbidden' then
      raise exception 'FAIL [%]: error inesperado (no forbidden): %', p_label, sqlerrm;
    end if;
  end;
  if v_returned then
    raise exception 'FAIL [%]: se esperaba forbidden pero get_player_medical devolvió datos', p_label;
  end if;
end $$;

-- set_player_medical debe funcionar (escribe).
create or replace function pg_temp.assert_writes(
  p_label text, p_sub text, p_player uuid
) returns void language plpgsql as $$
begin
  perform pg_temp.set_auth(p_sub);
  perform public.set_player_medical(p_player, 'W-'||p_label, null, null, null);
exception when others then
  raise exception 'FAIL [%]: set_player_medical debía escribir pero falló: %', p_label, sqlerrm;
end $$;

-- set_player_medical debe lanzar 'forbidden'.
create or replace function pg_temp.assert_write_forbidden(
  p_label text, p_sub text, p_player uuid
) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  perform pg_temp.set_auth(p_sub);
  begin
    perform public.set_player_medical(p_player, 'X', null, null, null);
    v_ok := true;
  exception when others then
    if sqlerrm <> 'forbidden' then
      raise exception 'FAIL [%]: error inesperado (no forbidden): %', p_label, sqlerrm;
    end if;
  end;
  if v_ok then
    raise exception 'FAIL [%]: se esperaba forbidden pero set_player_medical escribió', p_label;
  end if;
end $$;

-- ── Scaffold (como postgres: bypassa RLS) ───────────────────────────────────────
-- 2 clubs; club X con 3 equipos (base team1/team2 + superior teamPromo) y club Y.
insert into public.clubs (id, name, slug) values
  ('ed100000-cccc-0000-0000-000000000001', 'Club X', 'x-medical-c1'),
  ('ed100000-cccc-0000-0000-000000000002', 'Club Y', 'y-medical-c1');

insert into public.seasons (id, club_id, label, status) values
  ('ed100000-5ea5-0000-0000-0000000000a1', 'ed100000-cccc-0000-0000-000000000001', '2025-26', 'active'),
  ('ed100000-5ea5-0000-0000-0000000000f1', 'ed100000-cccc-0000-0000-000000000001', '2024-25', 'finalized');

insert into public.categories (id, club_id, name, kind) values
  ('ed100000-ca70-0000-0000-0000000000a1', 'ed100000-cccc-0000-0000-000000000001', 'Benjamín', 'benjamin'),
  ('ed100000-ca70-0000-0000-0000000000a2', 'ed100000-cccc-0000-0000-000000000001', 'Alevín',   'alevin'),
  ('ed100000-ca70-0000-0000-0000000000b1', 'ed100000-cccc-0000-0000-000000000002', 'Benjamín Y', 'benjamin');

insert into public.teams (id, category_id, name, format, color, season) values
  ('ed100000-7ea0-0000-0000-0000000000a1', 'ed100000-ca70-0000-0000-0000000000a1', 'Team 1',     'F7', '#10B981', '2025-26'),
  ('ed100000-7ea0-0000-0000-0000000000a2', 'ed100000-ca70-0000-0000-0000000000a1', 'Team 2',     'F7', '#10B981', '2025-26'),
  ('ed100000-7ea0-0000-0000-0000000000a3', 'ed100000-ca70-0000-0000-0000000000a2', 'Team Promo', 'F7', '#10B981', '2025-26'),
  ('ed100000-7ea0-0000-0000-0000000000b1', 'ed100000-ca70-0000-0000-0000000000b1', 'Team Y',     'F7', '#10B981', '2025-26');

-- Menores del club X, todos en team1 (equipo base).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ed100000-0000-aaaa-0000-000000000001', 'ed100000-cccc-0000-0000-000000000001', 'P1', 'ConCon',   '2015-04-12'),
  ('ed100000-0000-aaaa-0000-000000000002', 'ed100000-cccc-0000-0000-000000000001', 'P2', 'SinCon',   '2015-04-12'),
  ('ed100000-0000-aaaa-0000-000000000003', 'ed100000-cccc-0000-0000-000000000001', 'P3', 'Retirado', '2015-04-12'),
  ('ed100000-0000-aaaa-0000-000000000005', 'ed100000-cccc-0000-0000-000000000001', 'P5', 'ConNoAct', '2015-04-12'),
  ('ed100000-0000-aaaa-0000-000000000006', 'ed100000-cccc-0000-0000-000000000001', 'P6', 'Ajeno',    '2015-04-12');

insert into public.team_members (player_id, team_id, joined_at) values
  ('ed100000-0000-aaaa-0000-000000000001', 'ed100000-7ea0-0000-0000-0000000000a1', '2025-08-01'),
  ('ed100000-0000-aaaa-0000-000000000002', 'ed100000-7ea0-0000-0000-0000000000a1', '2025-08-01'),
  ('ed100000-0000-aaaa-0000-000000000003', 'ed100000-7ea0-0000-0000-0000000000a1', '2025-08-01'),
  ('ed100000-0000-aaaa-0000-000000000005', 'ed100000-7ea0-0000-0000-0000000000a1', '2025-08-01'),
  ('ed100000-0000-aaaa-0000-000000000006', 'ed100000-7ea0-0000-0000-0000000000a1', '2025-08-01');

-- Datos médicos reales (sembrados; player_medical está cerrada al cliente).
insert into public.player_medical (player_id, allergies) values
  ('ed100000-0000-aaaa-0000-000000000001', 'P1-med'),
  ('ed100000-0000-aaaa-0000-000000000002', 'P2-med'),
  ('ed100000-0000-aaaa-0000-000000000003', 'P3-med'),
  ('ed100000-0000-aaaa-0000-000000000005', 'P5-med'),
  ('ed100000-0000-aaaa-0000-000000000006', 'P6-med');

-- Usuarios.
select pg_temp.new_test_user('ed100000-1111-0000-0000-000000000001', 'staff1@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-1111-0000-0000-000000000002', 'staff2@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-1111-0000-0000-000000000003', 'staffpromo@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-2222-0000-0000-000000000001', 'admin@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-2222-0000-0000-000000000002', 'director@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-2222-0000-0000-000000000003', 'coord@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-3333-0000-0000-000000000001', 'tutorA@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-3333-0000-0000-000000000002', 'tutorB@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-4444-0000-0000-000000000001', 'jugador@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-4444-0000-0000-000000000002', 'seguidor@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('ed100000-5555-0000-0000-000000000001', 'staffY@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('ed100000-115e-0000-0000-000000000001', 'ed100000-1111-0000-0000-000000000001', 'ed100000-cccc-0000-0000-000000000001', 'entrenador_principal'),
  ('ed100000-115e-0000-0000-000000000002', 'ed100000-1111-0000-0000-000000000002', 'ed100000-cccc-0000-0000-000000000001', 'entrenador_principal'),
  ('ed100000-115e-0000-0000-000000000003', 'ed100000-1111-0000-0000-000000000003', 'ed100000-cccc-0000-0000-000000000001', 'entrenador_principal'),
  ('ed100000-115e-0000-0000-000000000004', 'ed100000-2222-0000-0000-000000000001', 'ed100000-cccc-0000-0000-000000000001', 'admin_club'),
  ('ed100000-115e-0000-0000-000000000005', 'ed100000-2222-0000-0000-000000000002', 'ed100000-cccc-0000-0000-000000000001', 'director'),
  ('ed100000-115e-0000-0000-000000000006', 'ed100000-2222-0000-0000-000000000003', 'ed100000-cccc-0000-0000-000000000001', 'coordinador'),
  ('ed100000-115e-0000-0000-000000000007', 'ed100000-3333-0000-0000-000000000001', 'ed100000-cccc-0000-0000-000000000001', 'jugador'),
  ('ed100000-115e-0000-0000-000000000008', 'ed100000-3333-0000-0000-000000000002', 'ed100000-cccc-0000-0000-000000000001', 'jugador'),
  ('ed100000-115e-0000-0000-000000000009', 'ed100000-4444-0000-0000-000000000001', 'ed100000-cccc-0000-0000-000000000001', 'jugador'),
  ('ed100000-115e-0000-0000-00000000000a', 'ed100000-4444-0000-0000-000000000002', 'ed100000-cccc-0000-0000-000000000001', 'jugador'),
  ('ed100000-115e-0000-0000-00000000000b', 'ed100000-5555-0000-0000-000000000001', 'ed100000-cccc-0000-0000-000000000002', 'entrenador_principal');

-- team_staff: staff1→team1, staff2→team2, staffPromo→teamPromo, staffY→teamY.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('ed100000-7ea0-0000-0000-0000000000a1', 'ed100000-115e-0000-0000-000000000001', 'entrenador_principal'),
  ('ed100000-7ea0-0000-0000-0000000000a2', 'ed100000-115e-0000-0000-000000000002', 'entrenador_principal'),
  ('ed100000-7ea0-0000-0000-0000000000a3', 'ed100000-115e-0000-0000-000000000003', 'entrenador_principal'),
  ('ed100000-7ea0-0000-0000-0000000000b1', 'ed100000-115e-0000-0000-00000000000b', 'entrenador_principal');

-- Tutores: A→P1,P2,P3,P5 ; B→P6 (ajeno para A).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('ed100000-0000-aaaa-0000-000000000001', 'ed100000-3333-0000-0000-000000000001', 'parent'),
  ('ed100000-0000-aaaa-0000-000000000002', 'ed100000-3333-0000-0000-000000000001', 'parent'),
  ('ed100000-0000-aaaa-0000-000000000003', 'ed100000-3333-0000-0000-000000000001', 'parent'),
  ('ed100000-0000-aaaa-0000-000000000005', 'ed100000-3333-0000-0000-000000000001', 'parent'),
  ('ed100000-0000-aaaa-0000-000000000006', 'ed100000-3333-0000-0000-000000000002', 'parent');

-- Seguidor (F14C): vínculo de espectador a P1 (no da acceso a médica).
insert into public.player_spectators (spectator_profile_id, player_id) values
  ('ed100000-4444-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000001');

-- Promoción de P1 al equipo superior (teamPromo): evento en teamPromo + fila.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('ed100000-e0e0-0000-0000-0000000000a1', 'ed100000-cccc-0000-0000-000000000001',
   'ed100000-7ea0-0000-0000-0000000000a3', 'match', 'Amistoso superior', '2025-09-20 10:00:00+00',
   'ed100000-2222-0000-0000-000000000001');
insert into public.player_promotions (player_id, event_id, team_id, kind, club_id) values
  ('ed100000-0000-aaaa-0000-000000000001', 'ed100000-e0e0-0000-0000-0000000000a1',
   'ed100000-7ea0-0000-0000-0000000000a3', 'match', 'ed100000-cccc-0000-0000-000000000001');

-- Consentimientos médicos (sembrados como postgres; el forjado ya se prueba en
-- rls_consents_forge_gate). legal_document_id = el médico del club X.
--   P1: otorgado, temporada ACTIVA        → lectura y escritura vigentes
--   P3: otorgado viejo + RETIRADO nuevo    → lectura NO vigente (latest-wins)
--   P5: otorgado en temporada NO activa    → lectura sí (global), escritura NO (season)
--   P6: otorgado por el tutor B            → aislamiento (C1)
insert into public.consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, legal_document_id, accepted_at) values
  ('ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001', 'medical_data_processing', true, 1,
   'ed100000-5ea5-0000-0000-0000000000a1',
   (select id from public.legal_documents where club_id='ed100000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent'), now()),
  ('ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000003', 'medical_data_processing', true, 1,
   'ed100000-5ea5-0000-0000-0000000000a1',
   (select id from public.legal_documents where club_id='ed100000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent'), now() - interval '2 days'),
  ('ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000003', 'medical_data_processing', false, 1,
   'ed100000-5ea5-0000-0000-0000000000a1',
   (select id from public.legal_documents where club_id='ed100000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent'), now()),
  ('ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000005', 'medical_data_processing', true, 1,
   'ed100000-5ea5-0000-0000-0000000000f1',
   (select id from public.legal_documents where club_id='ed100000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent'), now()),
  ('ed100000-3333-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000006', 'medical_data_processing', true, 1,
   'ed100000-5ea5-0000-0000-0000000000a1',
   (select id from public.legal_documents where club_id='ed100000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent'), now());

-- ── LECTURA ────────────────────────────────────────────────────────────────────
select pg_temp.assert_reads    ('L1  staff1/team1 con consent',  'ed100000-1111-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001', 'P1-med');
select pg_temp.assert_forbidden('L2  staff1/team1 SIN consent',  'ed100000-1111-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000002');
select pg_temp.assert_forbidden('L3  staff1/team1 RETIRADO',     'ed100000-1111-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000003');
select pg_temp.assert_forbidden('L4  staff2/team2 (otro equipo)','ed100000-1111-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_forbidden('L5  staffY (otro club)',        'ed100000-5555-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_forbidden('L6a admin SIN consent',         'ed100000-2222-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000002');
select pg_temp.assert_forbidden('L6b director SIN consent',      'ed100000-2222-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000002');
select pg_temp.assert_reads    ('L7a admin CON consent',         'ed100000-2222-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001', 'P1-med');
select pg_temp.assert_reads    ('L7b director CON consent',      'ed100000-2222-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000001', 'P1-med');
select pg_temp.assert_reads    ('L8a tutorA ve su hijo P1',      'ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001', 'P1-med');
select pg_temp.assert_forbidden('L8b tutorA en hijo ajeno P6',   'ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000006');
select pg_temp.assert_forbidden('L9a jugador sin vínculo',       'ed100000-4444-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_forbidden('L9b seguidor',                  'ed100000-4444-0000-0000-000000000002', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_forbidden('L9c coordinador ajeno',         'ed100000-2222-0000-0000-000000000003', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_reads    ('L10 staffPromo (promociona P1)','ed100000-1111-0000-0000-000000000003', 'ed100000-0000-aaaa-0000-000000000001', 'P1-med');

-- ── ESCRITURA ──────────────────────────────────────────────────────────────────
select pg_temp.assert_write_forbidden('E1  staff (no tutor)',          'ed100000-1111-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001');
select pg_temp.assert_write_forbidden('E2  tutor SIN consent activa',  'ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000005');
select pg_temp.assert_writes         ('E3  tutor con consent activa',  'ed100000-3333-0000-0000-000000000001', 'ed100000-0000-aaaa-0000-000000000001');

-- ── APPEND-ONLY / CIERRE ────────────────────────────────────────────────────────
-- T1: ni service_role (bypassa RLS) puede UPDATE/DELETE consents (trigger).
reset role;
set local role service_role;
do $$
declare v_msg text;
begin
  v_msg := null;
  begin update public.consents set granted = false where player_id = 'ed100000-0000-aaaa-0000-000000000001';
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'FAIL [T1-update]: service_role pudo UPDATE consents'; end if;
  if v_msg not like '%append-only%' then raise exception 'FAIL [T1-update]: bloqueo inesperado: %', v_msg; end if;

  v_msg := null;
  begin delete from public.consents where player_id = 'ed100000-0000-aaaa-0000-000000000001';
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'FAIL [T1-delete]: service_role pudo DELETE consents'; end if;
  if v_msg not like '%append-only%' then raise exception 'FAIL [T1-delete]: bloqueo inesperado: %', v_msg; end if;
end $$;
reset role;

-- T2: authenticated no toca player_medical directo (privilegios revocados).
set local role authenticated;
set local "request.jwt.claim.sub" to 'ed100000-2222-0000-0000-000000000001';  -- admin: aun así, denegado
do $$
declare v_ok boolean;
begin
  v_ok := false;
  begin perform 1 from public.player_medical limit 1; v_ok := true; exception when insufficient_privilege then null; end;
  if v_ok then raise exception 'FAIL [T2-select]: authenticated pudo SELECT player_medical directo'; end if;

  v_ok := false;
  begin insert into public.player_medical (player_id, allergies) values ('ed100000-0000-aaaa-0000-000000000002', 'x'); v_ok := true;
  exception when insufficient_privilege then null; end;
  if v_ok then raise exception 'FAIL [T2-insert]: authenticated pudo INSERT player_medical directo'; end if;

  v_ok := false;
  begin update public.player_medical set allergies = 'x' where player_id = 'ed100000-0000-aaaa-0000-000000000001'; v_ok := true;
  exception when insufficient_privilege then null; end;
  if v_ok then raise exception 'FAIL [T2-update]: authenticated pudo UPDATE player_medical directo'; end if;
end $$;
reset role;

-- ── AISLAMIENTO ─────────────────────────────────────────────────────────────────
-- C1: tutorA solo ve SUS consents (consents_select_own), no los de tutorB.
set local role authenticated;
set local "request.jwt.claim.sub" to 'ed100000-3333-0000-0000-000000000001';
do $$
declare v_own int; v_other int;
begin
  select count(*) into v_own   from public.consents where tutor_profile_id = 'ed100000-3333-0000-0000-000000000001';
  select count(*) into v_other from public.consents where tutor_profile_id = 'ed100000-3333-0000-0000-000000000002';
  if v_own = 0 then raise exception 'FAIL [C1]: tutorA no ve NINGUNO de sus consents (scaffold roto)'; end if;
  if v_other <> 0 then raise exception 'FAIL [C1]: tutorA ve % consents del tutorB (fuga)', v_other; end if;
end $$;
reset role;

-- C2: un miembro del club X no ve legal_documents del club Y (per-club).
set local role authenticated;
set local "request.jwt.claim.sub" to 'ed100000-2222-0000-0000-000000000001';  -- admin de X
do $$
declare v_x int; v_y int;
begin
  select count(*) into v_x from public.legal_documents where club_id = 'ed100000-cccc-0000-0000-000000000001';
  select count(*) into v_y from public.legal_documents where club_id = 'ed100000-cccc-0000-0000-000000000002';
  if v_x = 0 then raise exception 'FAIL [C2]: el admin de X no ve los legal_documents de X (scaffold roto)'; end if;
  if v_y <> 0 then raise exception 'FAIL [C2]: el admin de X ve % legal_documents del club Y (fuga)', v_y; end if;
end $$;
reset role;

rollback;
