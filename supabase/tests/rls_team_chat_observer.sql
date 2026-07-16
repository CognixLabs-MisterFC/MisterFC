-- F5B-4 — Tests RLS del modo OBSERVER del director en el chat de equipo.
--
-- Cobertura:
--   O1. Director SIN fila (observer default): SELECT del chat B OK; INSERT en B ❌.
--   O2. Director con fila mode='active' en team A: INSERT en A OK.
--   O3. Staff del equipo A: INSERT OK (no afectado por observer).
--   O4. Jugador/familia del equipo A: INSERT OK (no afectado).
--   O5. Fan-out: director active ∈ recipients(A); director observer ∉ recipients(B);
--       staff/jugador SIEMPRE ∈ recipients.
--   O6. Aislamiento entre clubs: director de otro club no ve ni escribe en A.
\ir helpers/auth_users.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('aaaa1111-1111-4111-8111-000000000001', 'Club O1', 'club-o1-obs'),
  ('aaaa2222-2222-4222-8222-000000000002', 'Club O2', 'club-o2-obs');

insert into public.categories (id, club_id, name) values
  ('bbbb1111-1111-4111-8111-000000000001', 'aaaa1111-1111-4111-8111-000000000001', 'Cat O1'),
  ('bbbb2222-2222-4222-8222-000000000002', 'aaaa2222-2222-4222-8222-000000000002', 'Cat O2');

-- Teams A y B en el club O1 (club_id explícito: NOT NULL desde Rework A1).
insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('cccc1111-1111-4111-8111-00000000000a', 'bbbb1111-1111-4111-8111-000000000001', 'Team A', 'F7', '#10B981', '2025-26', 'aaaa1111-1111-4111-8111-000000000001'),
  ('cccc1111-1111-4111-8111-00000000000b', 'bbbb1111-1111-4111-8111-000000000001', 'Team B', 'F7', '#10B981', '2025-26', 'aaaa1111-1111-4111-8111-000000000001');

-- Usuarios: D director de O1; SA staff de A; SB staff de B; PL familia de A;
-- D2 director de O2 (aislamiento).
select pg_temp.new_test_user('dddd0000-0000-4000-8000-0000000000d1', 'dir-o1@obs.test', '{}'::jsonb);
select pg_temp.new_test_user('dddd0000-0000-4000-8000-00000000005a', 'sa-o1@obs.test', '{}'::jsonb);
select pg_temp.new_test_user('dddd0000-0000-4000-8000-00000000005b', 'sb-o1@obs.test', '{}'::jsonb);
select pg_temp.new_test_user('dddd0000-0000-4000-8000-0000000000f1', 'pl-o1@obs.test', '{}'::jsonb);
select pg_temp.new_test_user('dddd0000-0000-4000-8000-0000000000d2', 'dir-o2@obs.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55550000-0000-4000-8000-0000000000d1', 'dddd0000-0000-4000-8000-0000000000d1', 'aaaa1111-1111-4111-8111-000000000001', 'director'),
  ('55550000-0000-4000-8000-00000000005a', 'dddd0000-0000-4000-8000-00000000005a', 'aaaa1111-1111-4111-8111-000000000001', 'entrenador_principal'),
  ('55550000-0000-4000-8000-00000000005b', 'dddd0000-0000-4000-8000-00000000005b', 'aaaa1111-1111-4111-8111-000000000001', 'entrenador_principal'),
  ('55550000-0000-4000-8000-0000000000f1', 'dddd0000-0000-4000-8000-0000000000f1', 'aaaa1111-1111-4111-8111-000000000001', 'jugador'),
  ('55550000-0000-4000-8000-0000000000d2', 'dddd0000-0000-4000-8000-0000000000d2', 'aaaa2222-2222-4222-8222-000000000002', 'director');

-- Staff: SA entrena A, SB entrena B.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('cccc1111-1111-4111-8111-00000000000a', '55550000-0000-4000-8000-00000000005a', 'entrenador_principal'),
  ('cccc1111-1111-4111-8111-00000000000b', '55550000-0000-4000-8000-00000000005b', 'entrenador_principal');

-- Jugador de A + familia PL en su roster vigente.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('eeee0000-0000-4000-8000-0000000000a1', 'aaaa1111-1111-4111-8111-000000000001', 'Aitor', 'Test', '2013-05-10');

insert into public.team_members (player_id, team_id) values
  ('eeee0000-0000-4000-8000-0000000000a1', 'cccc1111-1111-4111-8111-00000000000a');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('eeee0000-0000-4000-8000-0000000000a1', 'dddd0000-0000-4000-8000-0000000000f1', 'parent');

-- Hilos de grupo A y B.
insert into public.team_conversations (id, club_id, team_id) values
  ('99990000-0000-4000-8000-0000000000aa', 'aaaa1111-1111-4111-8111-000000000001', 'cccc1111-1111-4111-8111-00000000000a'),
  ('99990000-0000-4000-8000-0000000000bb', 'aaaa1111-1111-4111-8111-000000000001', 'cccc1111-1111-4111-8111-00000000000b');

-- Participación: D ACTIVE en A (observer en B por ausencia de fila).
insert into public.team_chat_participation (profile_id, team_id, mode) values
  ('dddd0000-0000-4000-8000-0000000000d1', 'cccc1111-1111-4111-8111-00000000000a', 'active');

-- Semilla: un mensaje en A (por SA) y otro en B (por SB), como emisores válidos.
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-00000000005a","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
    ('99990000-0000-4000-8000-0000000000aa', 'dddd0000-0000-4000-8000-00000000005a', 'Mensaje staff A');
  reset role;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-00000000005b","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
    ('99990000-0000-4000-8000-0000000000bb', 'dddd0000-0000-4000-8000-00000000005b', 'Mensaje staff B');
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O1: Director observer en B → SELECT OK (ve el hilo), INSERT ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int; ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-0000000000d1","role":"authenticated"}';

  -- SELECT: el director sigue viendo TODO (SELECT no cambia).
  select count(*) into v_count from public.team_messages
   where team_conversation_id = '99990000-0000-4000-8000-0000000000bb';
  if v_count < 1 then
    raise exception 'FAIL [O1a]: director observer no ve los mensajes de B (count=%)', v_count;
  end if;

  -- INSERT: observer (sin fila active en B) → rechazado por RLS.
  begin
    insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
      ('99990000-0000-4000-8000-0000000000bb', 'dddd0000-0000-4000-8000-0000000000d1', 'intento observer');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [O1b]: director observer PUDO escribir en B (debía bloquearse)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O2: Director active en A → INSERT OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-0000000000d1","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
    ('99990000-0000-4000-8000-0000000000aa', 'dddd0000-0000-4000-8000-0000000000d1', 'director participa en A')
  returning id into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL [O2]: director active no pudo escribir en A';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O3: Staff de A → INSERT OK (no afectado por observer)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-00000000005a","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
    ('99990000-0000-4000-8000-0000000000aa', 'dddd0000-0000-4000-8000-00000000005a', 'staff sigue escribiendo')
  returning id into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL [O3]: staff no pudo escribir en su equipo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O4: Jugador/familia de A → INSERT OK (no afectado)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-0000000000f1","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
    ('99990000-0000-4000-8000-0000000000aa', 'dddd0000-0000-4000-8000-0000000000f1', 'familia escribe')
  returning id into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL [O4]: jugador/familia no pudo escribir';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O5: Fan-out — recipients por team
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  a_has_dir boolean; a_has_sa boolean; a_has_pl boolean;
  b_has_dir boolean; b_has_sb boolean;
begin
  select exists(select 1 from public.team_chat_member_profile_ids('cccc1111-1111-4111-8111-00000000000a') x where x = 'dddd0000-0000-4000-8000-0000000000d1') into a_has_dir;
  select exists(select 1 from public.team_chat_member_profile_ids('cccc1111-1111-4111-8111-00000000000a') x where x = 'dddd0000-0000-4000-8000-00000000005a') into a_has_sa;
  select exists(select 1 from public.team_chat_member_profile_ids('cccc1111-1111-4111-8111-00000000000a') x where x = 'dddd0000-0000-4000-8000-0000000000f1') into a_has_pl;
  select exists(select 1 from public.team_chat_member_profile_ids('cccc1111-1111-4111-8111-00000000000b') x where x = 'dddd0000-0000-4000-8000-0000000000d1') into b_has_dir;
  select exists(select 1 from public.team_chat_member_profile_ids('cccc1111-1111-4111-8111-00000000000b') x where x = 'dddd0000-0000-4000-8000-00000000005b') into b_has_sb;

  if not a_has_dir then raise exception 'FAIL [O5a]: director active NO está en recipients(A)'; end if;
  if not a_has_sa  then raise exception 'FAIL [O5b]: staff NO está en recipients(A)'; end if;
  if not a_has_pl  then raise exception 'FAIL [O5c]: jugador/familia NO está en recipients(A)'; end if;
  if b_has_dir     then raise exception 'FAIL [O5d]: director OBSERVER está en recipients(B) (debía excluirse)'; end if;
  if not b_has_sb  then raise exception 'FAIL [O5e]: staff NO está en recipients(B)'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O6: Aislamiento — director de OTRO club no ve ni escribe en A
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int; ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dddd0000-0000-4000-8000-0000000000d2","role":"authenticated"}';

  select count(*) into v_count from public.team_messages
   where team_conversation_id = '99990000-0000-4000-8000-0000000000aa';
  if v_count <> 0 then
    raise exception 'FAIL [O6a]: director de otro club VE mensajes de A (count=%)', v_count;
  end if;

  begin
    insert into public.team_messages (team_conversation_id, sender_profile_id, body) values
      ('99990000-0000-4000-8000-0000000000aa', 'dddd0000-0000-4000-8000-0000000000d2', 'cross-club');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [O6b]: director de otro club PUDO escribir en A';
  end if;
end $$;

rollback;

select 'OK rls_team_chat_observer' as result;
