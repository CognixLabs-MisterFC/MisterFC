-- Tests del fix de visibilidad de clubs para invitados con invitación pendiente.
--
-- Verifica:
--   T1. Invitado con invitación pendiente válida → ve el club referenciado.
--   T2. Invitado con invitación caducada → NO ve el club.
--   T3. Invitado con invitación ya aceptada → NO ve el club (vía esta policy;
--       lo verá vía clubs_select_member una vez tenga la membership).
--   T4. User SIN ninguna invitación a un club → NO ve ese club.
--   T5. La policy NO debilita aislamiento multi-tenant: el invitado al club A
--       sigue sin ver el club B.
\ir helpers/auth_users.sql

begin;

-- Setup
select pg_temp.new_test_user('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@test.local', '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invited@test.local', '{"full_name":"Invited"}'::jsonb);
select pg_temp.new_test_user('cccccccc-cccc-cccc-cccc-cccccccccccc', 'expired@test.local', '{"full_name":"Expired"}'::jsonb);
select pg_temp.new_test_user('dddddddd-dddd-dddd-dddd-dddddddddddd', 'accepted@test.local', '{"full_name":"Accepted"}'::jsonb);
select pg_temp.new_test_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'noinvite@test.local', '{"full_name":"NoInvite"}'::jsonb);

insert into public.clubs (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Club A', 'club-a-pending-test'),
  ('22222222-2222-2222-2222-222222222222', 'Club B', 'club-b-pending-test');

-- admin es admin del Club A (membership_id 55... usada en otros tests; aquí usamos otro)
insert into public.memberships (id, profile_id, club_id, role) values
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'admin_club');

-- Invitaciones:
-- - invited@: pendiente, válida, Club A.
-- - expired@: caducada (expires_at en el pasado), Club A.
-- - accepted@: ya aceptada, Club A.
insert into public.invitations (id, token, email, club_id, role, expires_at, accepted_at, created_by) values
  ('a0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000aaa001',
   'invited@test.local', '11111111-1111-1111-1111-111111111111', 'entrenador_principal',
   now() + interval '7 days', null, 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000002-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000aaa002',
   'expired@test.local', '11111111-1111-1111-1111-111111111111', 'entrenador_principal',
   now() - interval '1 day', null, 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000003-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000aaa003',
   'accepted@test.local', '11111111-1111-1111-1111-111111111111', 'entrenador_principal',
   now() + interval '7 days', now(), 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: invited@ ve el Club A (su invitación está pendiente)
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs where id = '11111111-1111-1111-1111-111111111111';
  if visible <> 1 then
    raise exception 'FAIL [T1]: invited@ debería ver Club A vía pending invitation, visible=%', visible;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: expired@ NO ve el club (su invitación caducó)
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs where id = '11111111-1111-1111-1111-111111111111';
  if visible <> 0 then
    raise exception 'FAIL [T2]: expired@ ve el club (invitación caducada debería bloquear), visible=%', visible;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: accepted@ NO ve el club vía esta policy (debería verlo vía membership,
--     que no creamos aquí — controlamos que la policy nueva no le dé acceso
--     "sobrante" cuando la invitación ya está consumida).
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs where id = '11111111-1111-1111-1111-111111111111';
  if visible <> 0 then
    raise exception 'FAIL [T3]: accepted@ ve el club vía invitación ya aceptada, visible=%', visible;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: noinvite@ NO ve ningún club (sin invitación, sin membership)
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs;
  if visible <> 0 then
    raise exception 'FAIL [T4]: noinvite@ ve % clubs (esperado 0)', visible;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5: aislamiento multi-tenant intacto — invited@ no ve Club B
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
begin
  if exists (select 1 from public.clubs where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FAIL [T5]: invited@ ve Club B (LEAK multi-tenant)';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests de clubs visibility para pending invites pasaron.'
\echo '──────────────────────────────────────────────'
