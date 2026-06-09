-- Tests F2.2 — Helpers SQL del jugador
--
-- Verifica:
--   H1. user_can_see_player → true para cualquier miembro del club, false fuera.
--   H2. user_can_manage_player → true para admin/coord/principal, true para
--       ayudante con can_manage_squad, false para ayudante sin capability y
--       false para jugador.
--   H3. user_can_see_player_medical → true para admin/coord/principal, true
--       para ayudante con can_see_medical, true para tutor vinculado (player_accounts),
--       false para ayudante sin capability, false para jugador sin vínculo,
--       false cross-club.

begin;

-- Setup: 2 clubs, 1 jugador en cada uno.
insert into public.clubs (id, name, slug)
values
  ('cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'Club Alfa', 'alfa-helpers'),
  ('cccccccc-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Club Beta', 'beta-helpers');

insert into public.categories (id, club_id, name) values
  ('aaaaa000-0000-0000-0000-000000000001', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'Cat A'),
  ('aaaaa000-0000-0000-0000-000000000002', 'cccccccc-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('bbbbb000-0000-0000-0000-000000000001', 'aaaaa000-0000-0000-0000-000000000001', 'Team A', 'F7', '#10B981', '2025-26'),
  ('bbbbb000-0000-0000-0000-000000000002', 'aaaaa000-0000-0000-0000-000000000002', 'Team B', 'F7', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth)
values
  ('00000000-aaaa-0000-0000-000000000001', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'Player', 'A1', '2015-04-12'),
  ('00000000-bbbb-0000-0000-000000000001', 'cccccccc-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Player', 'B1', '2015-04-12');

-- Profiles + memberships (use auth.users del seed para roles)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('22222222-aaaa-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('33333333-aaaa-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-aaaa-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('55555555-aaaa-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-a-squad@h.test', now(), '{}'::jsonb, now(), now()),
  ('66666666-aaaa-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-a-med@h.test', now(), '{}'::jsonb, now(), now()),
  ('77777777-aaaa-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tutor-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('88888888-aaaa-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-a@h.test', now(), '{}'::jsonb, now(), now()),
  ('99999999-bbbb-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@h.test', now(), '{}'::jsonb, now(), now());

-- Trigger handle_new_user ya creó profiles.

insert into public.memberships (profile_id, club_id, role) values
  ('11111111-aaaa-1111-1111-111111111111', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'admin_club'),
  ('22222222-aaaa-2222-2222-222222222222', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'coordinador'),
  ('33333333-aaaa-3333-3333-333333333333', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'entrenador_principal'),
  ('44444444-aaaa-4444-4444-444444444444', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'entrenador_ayudante'),
  ('55555555-aaaa-5555-5555-555555555555', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'entrenador_ayudante'),
  ('66666666-aaaa-6666-6666-666666666666', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'entrenador_ayudante'),
  ('77777777-aaaa-7777-7777-777777777777', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'jugador'),
  ('88888888-aaaa-8888-8888-888888888888', 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'jugador'),
  ('99999999-bbbb-9999-9999-999999999999', 'cccccccc-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'admin_club');

-- Tutor A vinculado al jugador P_A1
insert into public.player_accounts (player_id, profile_id, relation) values
  ('00000000-aaaa-0000-0000-000000000001', '77777777-aaaa-7777-7777-777777777777', 'parent');

-- Capabilities: ayudante 55... con can_manage_squad; 66... con can_see_medical.
update public.capabilities
   set granted = true
 where capability_name = 'can_manage_squad'
   and membership_id = (select id from public.memberships
                       where profile_id = '55555555-aaaa-5555-5555-555555555555'
                         and club_id = 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0');

update public.capabilities
   set granted = true
 where capability_name = 'can_see_medical'
   and membership_id = (select id from public.memberships
                       where profile_id = '66666666-aaaa-6666-6666-666666666666'
                         and club_id = 'cccccccc-c0c0-c0c0-c0c0-c0c0c0c0c0c0');

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: aserta que user_can_see_player(player) = expected para sub
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pg_temp.assert_can_see(
  p_label text, p_sub text, p_player uuid, p_expected boolean
) returns void language plpgsql as $$
declare got boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"' || p_sub || '","role":"authenticated"}', true);
  select public.user_can_see_player(p_player) into got;
  if got is distinct from p_expected then
    raise exception 'FAIL [%]: user_can_see_player got % expected %',
      p_label, got, p_expected;
  end if;
end $$;

create or replace function pg_temp.assert_can_manage(
  p_label text, p_sub text, p_player uuid, p_expected boolean
) returns void language plpgsql as $$
declare got boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"' || p_sub || '","role":"authenticated"}', true);
  select public.user_can_manage_player(p_player) into got;
  if got is distinct from p_expected then
    raise exception 'FAIL [%]: user_can_manage_player got % expected %',
      p_label, got, p_expected;
  end if;
end $$;

create or replace function pg_temp.assert_can_see_medical(
  p_label text, p_sub text, p_player uuid, p_expected boolean
) returns void language plpgsql as $$
declare got boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"' || p_sub || '","role":"authenticated"}', true);
  select public.user_can_see_player_medical(p_player) into got;
  if got is distinct from p_expected then
    raise exception 'FAIL [%]: user_can_see_player_medical got % expected %',
      p_label, got, p_expected;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H1: user_can_see_player
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.assert_can_see('admin_a→P_A1', '11111111-aaaa-1111-1111-111111111111',
                              '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see('coord_a→P_A1', '22222222-aaaa-2222-2222-222222222222',
                              '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see('assistant_a→P_A1', '44444444-aaaa-4444-4444-444444444444',
                              '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see('jugador_a→P_A1', '88888888-aaaa-8888-8888-888888888888',
                              '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see('admin_b→P_A1 (cross-club)',
                              '99999999-bbbb-9999-9999-999999999999',
                              '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_see('admin_a→P_B1 (cross-club)',
                              '11111111-aaaa-1111-1111-111111111111',
                              '00000000-bbbb-0000-0000-000000000001', false);

-- ─────────────────────────────────────────────────────────────────────────────
-- H2: user_can_manage_player
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.assert_can_manage('admin_a', '11111111-aaaa-1111-1111-111111111111',
                                 '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_manage('coord_a', '22222222-aaaa-2222-2222-222222222222',
                                 '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_manage('principal_a', '33333333-aaaa-3333-3333-333333333333',
                                 '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_manage('assistant_a (sin caps)', '44444444-aaaa-4444-4444-444444444444',
                                 '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_manage('assistant_a (can_manage_squad)',
                                 '55555555-aaaa-5555-5555-555555555555',
                                 '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_manage('jugador_a', '88888888-aaaa-8888-8888-888888888888',
                                 '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_manage('admin_b cross-club',
                                 '99999999-bbbb-9999-9999-999999999999',
                                 '00000000-aaaa-0000-0000-000000000001', false);

-- ─────────────────────────────────────────────────────────────────────────────
-- H3: user_can_see_player_medical
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.assert_can_see_medical('admin_a', '11111111-aaaa-1111-1111-111111111111',
                                      '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see_medical('principal_a', '33333333-aaaa-3333-3333-333333333333',
                                      '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see_medical('assistant_a (sin caps)',
                                      '44444444-aaaa-4444-4444-444444444444',
                                      '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_see_medical('assistant_a (can_manage_squad sin medical)',
                                      '55555555-aaaa-5555-5555-555555555555',
                                      '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_see_medical('assistant_a (can_see_medical)',
                                      '66666666-aaaa-6666-6666-666666666666',
                                      '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see_medical('tutor_a vinculado',
                                      '77777777-aaaa-7777-7777-777777777777',
                                      '00000000-aaaa-0000-0000-000000000001', true);
select pg_temp.assert_can_see_medical('jugador_a sin vínculo',
                                      '88888888-aaaa-8888-8888-888888888888',
                                      '00000000-aaaa-0000-0000-000000000001', false);
select pg_temp.assert_can_see_medical('admin_b cross-club',
                                      '99999999-bbbb-9999-9999-999999999999',
                                      '00000000-aaaa-0000-0000-000000000001', false);

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests helpers user_can_*_player pasaron.'
\echo '──────────────────────────────────────────────'
