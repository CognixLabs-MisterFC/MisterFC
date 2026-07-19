-- F14K-1 · FIX de visibilidad — el DIRECTOR ve TODAS las invitaciones de su club.
--
-- Antes del fix, invitations_select_admin_or_invited tenía la rama de admin en
-- `user_role_in_club(club_id) = 'admin_club'`: un director solo veía las que creó
-- él. El fix la amplía a IN ('admin_club','director'). El coordinador SIGUE fuera.
--
-- Todas las invitaciones de prueba las crea el ADMIN (created_by = adminA) y con
-- emails que NO son los del director/coordinador y sin team_id → así las otras
-- ramas de la policy (created_by = self, email = self, principal del team) NO
-- aplican, y lo único que puede dar visibilidad es la rama de rol. Es la forma de
-- aislar que el fix (y solo el fix) es lo que deja ver al director.
--
-- Casos:
--   T1. director de A → ve las 2 invitaciones del club A (antes: 0). CORE del fix.
--   T2. coordinador de A → ve 0 (no gana acceso; sigue fuera).
--   T3. admin de A → ve las 2 (comportamiento previo intacto).
--   T4. director de A NO ve la invitación del club B (aislamiento multi-tenant).
\ir helpers/auth_users.sql

begin;

-- Users
select pg_temp.new_test_user('a1000000-0000-4000-8000-000000000001', 'admina@test.local',    '{"full_name":"Admin A"}'::jsonb);
select pg_temp.new_test_user('d1000000-0000-4000-8000-000000000001', 'directora@test.local', '{"full_name":"Director A"}'::jsonb);
select pg_temp.new_test_user('c1000000-0000-4000-8000-000000000001', 'coorda@test.local',    '{"full_name":"Coord A"}'::jsonb);
select pg_temp.new_test_user('b1000000-0000-4000-8000-000000000001', 'adminb@test.local',    '{"full_name":"Admin B"}'::jsonb);

-- Clubs
insert into public.clubs (id, name, slug) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Club A', 'club-a-dir-inv-test'),
  ('bbbb0000-0000-4000-8000-000000000001', 'Club B', 'club-b-dir-inv-test');

-- Memberships (rol de club)
insert into public.memberships (id, profile_id, club_id, role) values
  ('a1a10000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', 'admin_club'),
  ('d1d10000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', 'director'),
  ('c1c10000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', 'coordinador'),
  ('b1b10000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001', 'admin_club');

-- Invitaciones del club A: creadas por el ADMIN, emails ajenos al director/coord,
-- sin team_id → solo la rama de rol puede darles visibilidad.
insert into public.invitations (id, token, email, club_id, role, expires_at, accepted_at, created_by) values
  ('a0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-0000000a0001',
   'invitee1@test.local', 'aaaa0000-0000-4000-8000-000000000001', 'entrenador_principal',
   now() + interval '7 days', null, 'a1000000-0000-4000-8000-000000000001'),
  ('a0000002-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-0000000a0002',
   'invitee2@test.local', 'aaaa0000-0000-4000-8000-000000000001', 'entrenador_principal',
   now() + interval '7 days', null, 'a1000000-0000-4000-8000-000000000001'),
  -- Invitación del club B (created_by adminB) — para el aislamiento.
  ('b0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-0000000b0001',
   'inviteeb@test.local', 'bbbb0000-0000-4000-8000-000000000001', 'entrenador_principal',
   now() + interval '7 days', null, 'b1000000-0000-4000-8000-000000000001');

set local role authenticated;

-- ── T1: director de A ve las 2 invitaciones del club A (CORE del fix) ──
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v int;
begin
  select count(*) into v from public.invitations where club_id = 'aaaa0000-0000-4000-8000-000000000001';
  if v <> 2 then
    raise exception 'FAIL [T1]: director de A debería ver 2 invitaciones del club, ve %', v;
  end if;
end $$;

-- ── T2: coordinador de A NO gana acceso (sigue fuera) ──
set local "request.jwt.claims" = '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v int;
begin
  select count(*) into v from public.invitations where club_id = 'aaaa0000-0000-4000-8000-000000000001';
  if v <> 0 then
    raise exception 'FAIL [T2]: coordinador NO debería ver invitaciones ajenas del club, ve %', v;
  end if;
end $$;

-- ── T3: admin de A ve las 2 (comportamiento previo intacto) ──
set local "request.jwt.claims" = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v int;
begin
  select count(*) into v from public.invitations where club_id = 'aaaa0000-0000-4000-8000-000000000001';
  if v <> 2 then
    raise exception 'FAIL [T3]: admin de A debería ver 2 invitaciones del club, ve %', v;
  end if;
end $$;

-- ── T4: director de A NO ve la invitación del club B (aislamiento) ──
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_b int; v_total int;
begin
  select count(*) into v_b from public.invitations where club_id = 'bbbb0000-0000-4000-8000-000000000001';
  if v_b <> 0 then
    raise exception 'FAIL [T4]: director de A ve invitación del club B (LEAK multi-tenant), ve %', v_b;
  end if;
  -- Belt: en total solo ve las 2 de su club.
  select count(*) into v_total from public.invitations;
  if v_total <> 2 then
    raise exception 'FAIL [T4]: director de A debería ver 2 invitaciones en total (solo su club), ve %', v_total;
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F14K-1: el director ve todas las invitaciones de su club; coordinador fuera; aislamiento intacto.'
\echo '──────────────────────────────────────────────'
