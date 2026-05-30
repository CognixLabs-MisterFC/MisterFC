-- F5 Lote A — Tests RLS de `conversations`.
--
-- Cobertura:
--   C1. Coach participant SELECT su propia conversation → OK.
--   C2. Tutor (player_account) SELECT la conversation del menor → OK.
--   C3. Otro coach del club que NO es participant → 0 rows (RLS bloquea).
--   C4. Admin del club NO ve conversation por SELECT directo (sin policy
--       override; el acceso de auditoría va por audit_get_conversation).
--   C5. INSERT participación cross-club rechazada por trigger same_club.
--   C6. UNIQUE (coach_profile_id, player_id) — segundo INSERT con misma
--       pareja → rechazado.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('11111111-1111-4111-8111-111111110001', 'Club Msg A', 'club-msg-a'),
  ('11111111-1111-4111-8111-111111110002', 'Club Msg B', 'club-msg-b');

insert into public.categories (id, club_id, name, season) values
  ('22222222-2222-4222-8222-222222220001', '11111111-1111-4111-8111-111111110001', 'Cat A', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('33333333-3333-4333-8333-333333330001', '22222222-2222-4222-8222-222222220001', 'Team A', 'F7', '#10B981');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44444444-4444-4444-8444-444444440001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-444444440002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach1@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-444444440003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach2@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-444444440004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tutor@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-444444440005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@msg.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55555555-5555-4555-8555-555555550001', '44444444-4444-4444-8444-444444440001', '11111111-1111-4111-8111-111111110001', 'admin_club'),
  ('55555555-5555-4555-8555-555555550002', '44444444-4444-4444-8444-444444440002', '11111111-1111-4111-8111-111111110001', 'entrenador_principal'),
  ('55555555-5555-4555-8555-555555550003', '44444444-4444-4444-8444-444444440003', '11111111-1111-4111-8111-111111110001', 'entrenador_principal'),
  ('55555555-5555-4555-8555-555555550004', '44444444-4444-4444-8444-444444440004', '11111111-1111-4111-8111-111111110001', 'jugador'),
  ('55555555-5555-4555-8555-555555550005', '44444444-4444-4444-8444-444444440005', '11111111-1111-4111-8111-111111110002', 'admin_club');

-- Player del club A. Tutor lo vincula por player_accounts.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66666666-6666-4666-8666-666666660001', '11111111-1111-4111-8111-111111110001', 'Pepe', 'Gomez', '2012-05-10');

insert into public.player_accounts (id, player_id, profile_id, relation) values
  ('77777777-7777-4777-8777-777777770001', '66666666-6666-4666-8666-666666660001', '44444444-4444-4444-8444-444444440004', 'parent');

-- Conversation: coach1 ↔ player Pepe.
insert into public.conversations (id, club_id, player_id, coach_profile_id) values
  ('88888888-8888-4888-8888-888888880001', '11111111-1111-4111-8111-111111110001',
   '66666666-6666-4666-8666-666666660001', '44444444-4444-4444-8444-444444440002');

-- ─────────────────────────────────────────────────────────────────────────────
-- C1: coach1 (participant) SELECT → 1 row
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-444444440002","role":"authenticated"}';
  select count(*) into v_count from public.conversations where id = '88888888-8888-4888-8888-888888880001';
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL [C1]: coach participant no ve su conversation (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C2: tutor (player_account) SELECT → 1 row
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-444444440004","role":"authenticated"}';
  select count(*) into v_count from public.conversations where id = '88888888-8888-4888-8888-888888880001';
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL [C2]: tutor no ve la conversation del menor (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C3: coach2 (otro principal del mismo club, NO participant) → 0 rows
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-444444440003","role":"authenticated"}';
  select count(*) into v_count from public.conversations where id = '88888888-8888-4888-8888-888888880001';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL [C3]: otro coach del club ve conversation ajena (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C4: admin del club NO ve conversation por SELECT directo (D4.bis)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-444444440001","role":"authenticated"}';
  select count(*) into v_count from public.conversations where id = '88888888-8888-4888-8888-888888880001';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL [C4]: admin del club ve conversation por SELECT directo (debería ir vía audit_get_conversation; count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C5: INSERT con club_id ≠ club del player → trigger conversations_same_club
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  -- Forzamos club_id incorrecto (club B) mientras el player es del club A.
  begin
    insert into public.conversations (club_id, player_id, coach_profile_id) values
      ('11111111-1111-4111-8111-111111110002',
       '66666666-6666-4666-8666-666666660001',
       '44444444-4444-4444-8444-444444440002');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C5]: INSERT cross-club no fue bloqueado por trigger';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C6: UNIQUE (coach_profile_id, player_id) — segundo INSERT con misma pareja
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.conversations (club_id, player_id, coach_profile_id) values
      ('11111111-1111-4111-8111-111111110001',
       '66666666-6666-4666-8666-666666660001',
       '44444444-4444-4444-8444-444444440002');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C6]: UNIQUE (coach, player) no fue respetada';
  end if;
end $$;

rollback;

select 'OK rls_conversations' as result;
