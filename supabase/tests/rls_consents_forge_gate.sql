-- F15-C0 — La RLS de INSERT de consents exige tutela sobre el player_id.
--
-- Cierra el forjado de consentimientos (RGPD art. 9, menores): un no-tutor no
-- puede insertar un consentimiento sobre un menor ajeno, así que no puede
-- derribar el gate de lectura de la médica ni re-exponer una foto retirada.
--
-- Invariantes:
--   T1. NO-TUTOR inserta consent médico de un menor ajeno → RECHAZADO (42501).
--   T2. TUTOR del jugador inserta su consent médico → PERMITIDO.
--   T3. Consent de CUENTA (player_id NULL) por cualquier authenticated → PERMITIDO.
--   T4. Ataque completo: staff (no-tutor, con acceso) NO puede leer la médica
--       (get_player_medical → forbidden) porque no puede forjar el consentimiento.
--   T4b. Tras el consent LEGÍTIMO del tutor (T2), ese staff SÍ lee (no sobre-bloqueo).
--   T5. NO-TUTOR forja image_internal de un menor ajeno → RECHAZADO (misma raíz).
\ir helpers/auth_users.sql

begin;

-- ── Scaffold: 1 club (auto-siembra legal_documents v1), temporada activa, equipo,
--    un menor en el equipo, tutor, staff (atacante con acceso) y un outsider. ──
insert into public.clubs (id, name, slug) values
  ('f15c0000-cccc-0000-0000-000000000001', 'Club C0', 'c0-consents-forge');

insert into public.seasons (id, club_id, label, status) values
  ('f15c0000-5ea5-0000-0000-000000000001', 'f15c0000-cccc-0000-0000-000000000001', '2025-26', 'active');

insert into public.categories (id, club_id, name) values
  ('f15c0000-ca70-0000-0000-000000000001', 'f15c0000-cccc-0000-0000-000000000001', 'Cat C0');

insert into public.teams (id, category_id, name, format, color, season) values
  ('f15c0000-7ea0-0000-0000-000000000001', 'f15c0000-ca70-0000-0000-000000000001', 'Team C0', 'F7', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f15c0000-0000-aaaa-0000-000000000001', 'f15c0000-cccc-0000-0000-000000000001', 'Menor', 'C0', '2015-04-12');

insert into public.team_members (player_id, team_id, joined_at) values
  ('f15c0000-0000-aaaa-0000-000000000001', 'f15c0000-7ea0-0000-0000-000000000001', '2025-08-01');

-- Datos médicos reales del menor (sembrados como postgres; la tabla está cerrada
-- al cliente). Sirven para el ataque de lectura T4.
insert into public.player_medical (player_id, allergies) values
  ('f15c0000-0000-aaaa-0000-000000000001', 'TEST-alergia');

select pg_temp.new_test_user('f15c0000-1111-1111-1111-111111111111', 'tutor-c0@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f15c0000-2222-2222-2222-222222222222', 'staff-c0@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f15c0000-3333-3333-3333-333333333333', 'outsider-c0@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('f15c0000-115e-0000-0000-000000000001', 'f15c0000-1111-1111-1111-111111111111', 'f15c0000-cccc-0000-0000-000000000001', 'jugador'),
  ('f15c0000-115e-0000-0000-000000000002', 'f15c0000-2222-2222-2222-222222222222', 'f15c0000-cccc-0000-0000-000000000001', 'entrenador_principal'),
  ('f15c0000-115e-0000-0000-000000000003', 'f15c0000-3333-3333-3333-333333333333', 'f15c0000-cccc-0000-0000-000000000001', 'jugador');

-- El staff es cuerpo técnico del equipo del menor → pasa user_can_access_player_medical.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('f15c0000-7ea0-0000-0000-000000000001', 'f15c0000-115e-0000-0000-000000000002', 'entrenador_principal');

-- El tutor está vinculado al menor (relation parent). El staff y el outsider NO.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('f15c0000-0000-aaaa-0000-000000000001', 'f15c0000-1111-1111-1111-111111111111', 'parent');

-- ── T1: NO-TUTOR (staff) forja consent MÉDICO del menor ajeno → RECHAZADO. ──
set local role authenticated;
set local "request.jwt.claim.sub" to 'f15c0000-2222-2222-2222-222222222222';
do $$
begin
  begin
    insert into public.consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, legal_document_id)
    values (
      'f15c0000-2222-2222-2222-222222222222', 'f15c0000-0000-aaaa-0000-000000000001',
      'medical_data_processing', true, 1, 'f15c0000-5ea5-0000-0000-000000000001',
      (select id from public.legal_documents where club_id='f15c0000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent')
    );
    raise exception 'FAIL [T1]: la RLS permitió a un NO-TUTOR forjar un consent médico de un menor ajeno';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── T4: el staff (con acceso) NO puede leer la médica: sin consent legítimo, y
--    sin poder forjarlo (T1), get_player_medical devuelve forbidden. ──
do $$
declare v_n int;
begin
  begin
    select count(*) into v_n from public.get_player_medical('f15c0000-0000-aaaa-0000-000000000001');
    raise exception 'FAIL [T4]: el staff leyó la médica sin consentimiento legítimo (filas=%)', v_n;
  exception when others then
    if sqlerrm <> 'forbidden' then
      raise exception 'FAIL [T4]: get_player_medical falló por motivo inesperado: %', sqlerrm;
    end if;
  end;
end $$;

-- ── T5: NO-TUTOR (staff) forja IMAGE_INTERNAL del menor ajeno → RECHAZADO. ──
do $$
begin
  begin
    insert into public.consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, legal_document_id)
    values (
      'f15c0000-2222-2222-2222-222222222222', 'f15c0000-0000-aaaa-0000-000000000001',
      'image_internal', true, 1, 'f15c0000-5ea5-0000-0000-000000000001',
      (select id from public.legal_documents where club_id='f15c0000-cccc-0000-0000-000000000001' and doc_type='image_internal')
    );
    raise exception 'FAIL [T5]: la RLS permitió a un NO-TUTOR forjar image_internal de un menor ajeno';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── T3: consent de CUENTA (player_id NULL) por un authenticated cualquiera → OK. ──
set local role authenticated;
set local "request.jwt.claim.sub" to 'f15c0000-3333-3333-3333-333333333333';
do $$
begin
  insert into public.consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, legal_document_id)
  values (
    'f15c0000-3333-3333-3333-333333333333', null,
    'terms_conditions', true, 1, 'f15c0000-5ea5-0000-0000-000000000001',
    (select id from public.legal_documents where club_id='f15c0000-cccc-0000-0000-000000000001' and doc_type='terms_conditions')
  );
exception when others then
  raise exception 'FAIL [T3]: un consent de cuenta (player_id NULL) debería permitirse: %', sqlerrm;
end $$;
reset role;

-- ── T2: el TUTOR del menor inserta su consent médico → PERMITIDO. ──
set local role authenticated;
set local "request.jwt.claim.sub" to 'f15c0000-1111-1111-1111-111111111111';
do $$
begin
  insert into public.consents (tutor_profile_id, player_id, consent_type, granted, legal_document_version, season_id, legal_document_id)
  values (
    'f15c0000-1111-1111-1111-111111111111', 'f15c0000-0000-aaaa-0000-000000000001',
    'medical_data_processing', true, 1, 'f15c0000-5ea5-0000-0000-000000000001',
    (select id from public.legal_documents where club_id='f15c0000-cccc-0000-0000-000000000001' and doc_type='medical_informed_consent')
  );
exception when others then
  raise exception 'FAIL [T2]: el tutor del jugador debería poder insertar su consent médico: %', sqlerrm;
end $$;
reset role;

-- ── T4b: con el consent LEGÍTIMO del tutor, el staff con acceso SÍ lee (no
--    sobre-bloqueamos el flujo correcto). ──
set local role authenticated;
set local "request.jwt.claim.sub" to 'f15c0000-2222-2222-2222-222222222222';
do $$
declare v_allergies text;
begin
  select allergies into v_allergies from public.get_player_medical('f15c0000-0000-aaaa-0000-000000000001');
  if v_allergies is distinct from 'TEST-alergia' then
    raise exception 'FAIL [T4b]: con consent legítimo el staff debería leer la médica (got %)', coalesce(v_allergies, 'NULL');
  end if;
end $$;
reset role;

rollback;
