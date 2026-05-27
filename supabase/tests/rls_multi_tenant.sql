-- Tests RLS de Fase 1 — aislamiento multi-tenant y capabilities del ayudante.
--
-- Ejecutar con `pnpm db:test` (envuelve en BEGIN/ROLLBACK contra la BD remota).
--
-- Estrategia:
--   1. Crear 4 users en auth.users → triggers handle_new_user crean profiles.
--   2. Crear 2 clubs + categories + teams + players + memberships.
--   3. Cambiar a role authenticated + JWT claim sub = user X.
--   4. Verificar que las queries respetan el aislamiento.
--   5. ROLLBACK al final → no quedan rastros.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- IDs (UUIDs hex válidos)
-- ─────────────────────────────────────────────────────────────────────────────
--   ALICE      aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa   admin_club en CLUB_A
--   BOB        bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb   admin_club en CLUB_B
--   AYUDANTE   aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa   ayudante en CLUB_A
--   JUGADOR    aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa   jugador en CLUB_A
--   CLUB_A     11111111-1111-1111-1111-111111111111
--   CLUB_B     22222222-2222-2222-2222-222222222222
--   CAT_A1     33333333-3333-3333-3333-333333333333
--   TEAM_A1    44444444-4444-4444-4444-444444444444
--   MEM_ALICE  55555555-5555-5555-5555-555555555555
--   MEM_BOB    66666666-6666-6666-6666-666666666666
--   MEM_AST    77777777-7777-7777-7777-777777777777
--   MEM_JUG    88888888-8888-8888-8888-888888888888
--   PLAYER_1   99999999-9999-9999-9999-999999999999
--   INV_1      eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee
--   TOKEN_1    ffffffff-ffff-ffff-ffff-ffffffffffff

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alice@test.local', now(), '{"full_name":"Alice Admin"}'::jsonb, now(), now()),
  ('bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bob@test.local', now(), '{"full_name":"Bob Admin"}'::jsonb, now(), now()),
  ('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'asst@test.local', now(), '{"full_name":"Ayudante Aitor"}'::jsonb, now(), now()),
  ('aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player@test.local', now(), '{"full_name":"Jugador Joaquin"}'::jsonb, now(), now());

do $$
declare c int;
begin
  select count(*) into c from public.profiles where id in (
    'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );
  if c <> 4 then
    raise exception 'FAIL: trigger handle_new_user no creó las 4 filas en profiles (encontradas %)', c;
  end if;
end $$;

insert into public.clubs (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Club Alice', 'club-alice-test'),
  ('22222222-2222-2222-2222-222222222222', 'Club Bob', 'club-bob-test');

insert into public.categories (id, club_id, name, season) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Prebenjamín', '2025-26');

insert into public.teams (id, category_id, name, format) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Prebenjamín A', 'F7');

insert into public.memberships (id, profile_id, club_id, role) values
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin_club'),
  ('66666666-6666-6666-6666-666666666666', 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'admin_club'),
  ('77777777-7777-7777-7777-777777777777', 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'entrenador_ayudante'),
  ('88888888-8888-8888-8888-888888888888', 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'jugador');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'Joaquin', 'Jiménez', '2015-03-10');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('99999999-9999-9999-9999-999999999999', 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'self');

insert into public.team_members (player_id, team_id) values
  ('99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444');

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: aislamiento multi-tenant (Alice solo ve su club; Bob solo el suyo)
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs;
  if visible <> 1 then
    raise exception 'FAIL [T1.a]: Alice ve % clubs (esperado 1)', visible;
  end if;

  if not exists (select 1 from public.clubs where id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FAIL [T1.b]: Alice no ve su propio club';
  end if;

  if exists (select 1 from public.clubs where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FAIL [T1.c]: Alice ve el club de Bob (LEAK MULTI-TENANT)';
  end if;

  select count(*) into visible from public.categories;
  if visible <> 1 then
    raise exception 'FAIL [T1.d]: Alice ve % categories (esperado 1)', visible;
  end if;

  select count(*) into visible from public.players;
  if visible <> 1 then
    raise exception 'FAIL [T1.e]: Alice ve % players (esperado 1)', visible;
  end if;
end $$;

set local "request.jwt.claims" = '{"sub":"bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs;
  if visible <> 1 then
    raise exception 'FAIL [T1.f]: Bob ve % clubs (esperado 1)', visible;
  end if;
  if exists (select 1 from public.players where club_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FAIL [T1.g]: Bob ve players de Alice (LEAK)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: ayudante sin capabilities solo lee
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.clubs;
  if visible <> 1 then
    raise exception 'FAIL [T2.a]: ayudante no ve su club';
  end if;
  select count(*) into visible from public.players;
  if visible <> 1 then
    raise exception 'FAIL [T2.b]: ayudante no ve players';
  end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.players (club_id, first_name, last_name, date_of_birth)
    values ('11111111-1111-1111-1111-111111111111', 'X', 'Y', '2016-01-01');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T2.c]: ayudante sin capability pudo insertar player';
  end if;
end $$;

-- Concedemos can_manage_squad al ayudante (postgres bypass)
reset role;
update public.capabilities
  set granted = true
  where membership_id = '77777777-7777-7777-7777-777777777777'
    and capability_name = 'can_manage_squad';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
begin
  insert into public.players (club_id, first_name, last_name, date_of_birth)
  values ('11111111-1111-1111-1111-111111111111', 'Test', 'Inserted', '2016-01-01');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: jugador ve datos del club, no puede escribir
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare visible int;
begin
  select count(*) into visible from public.players;
  if visible < 1 then
    raise exception 'FAIL [T3.a]: jugador no ve ningún player en su club';
  end if;

  select count(*) into visible from public.player_accounts;
  if visible < 1 then
    raise exception 'FAIL [T3.b]: jugador no ve su player_account';
  end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.players (club_id, first_name, last_name, date_of_birth)
    values ('11111111-1111-1111-1111-111111111111', 'Should', 'Fail', '2017-01-01');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T3.c]: jugador pudo insertar player';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: invitación visible al admin del club, no al admin de otro club
-- ─────────────────────────────────────────────────────────────────────────────

reset role;
insert into public.invitations (id, token, email, club_id, role, created_by) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   'newperson@test.local', '11111111-1111-1111-1111-111111111111', 'entrenador_principal',
   'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
begin
  if not exists (select 1 from public.invitations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') then
    raise exception 'FAIL [T4.a]: admin del club no ve invitación';
  end if;
end $$;

set local "request.jwt.claims" = '{"sub":"bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
begin
  if exists (select 1 from public.invitations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') then
    raise exception 'FAIL [T4.b]: admin de otro club ve invitación de un club ajeno (LEAK)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fin
-- ─────────────────────────────────────────────────────────────────────────────

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Todos los tests RLS pasaron (rollback hecho).'
\echo '──────────────────────────────────────────────'
