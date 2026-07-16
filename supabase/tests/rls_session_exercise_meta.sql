-- Tests F12.4 (fix) — session_exercise_meta (migración 20260719000000).
--
-- Cubre: un jugador (vía player_accounts) de una sesión PUBLICADA (visibility=
-- 'team') obtiene el NOMBRE del ejercicio referenciado; de una sesión BORRADOR
-- (visibility='staff') NO obtiene nada (gate user_can_see_session); el staff sí; y
-- solo se devuelven los ejercicios REFERENCIADOS por esa sesión (no todo el club).
-- Transaccional. IDs (HEX): owner d, jugador f; sesión pub a1, borrador a2.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5e540000-0000-4000-8000-000000000001', 'Club Meta', 'club-meta');
insert into public.categories (id, club_id, name, kind) values
  ('5e541000-0000-4000-8000-000000000001', '5e540000-0000-4000-8000-000000000001', 'Infantil', 'infantil');
insert into public.teams (id, category_id, name, format, color, season) values
  ('5e542000-0000-4000-8000-000000000001', '5e541000-0000-4000-8000-000000000001', 'Team Meta', 'F11', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5e543000-0000-4000-8000-00000000000f', '5e540000-0000-4000-8000-000000000001', 'Fede', 'M', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('5e542000-0000-4000-8000-000000000001', '5e543000-0000-4000-8000-00000000000f', '2025-09-01');

select pg_temp.new_test_user('5ea40000-0000-4000-8000-00000000000d', 'owner@meta.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea40000-0000-4000-8000-00000000000f', 'jug@meta.test', '{}'::jsonb);
insert into public.memberships (id, profile_id, club_id, role) values
  ('5e545000-0000-4000-8000-00000000000d', '5ea40000-0000-4000-8000-00000000000d', '5e540000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5e545000-0000-4000-8000-00000000000f', '5ea40000-0000-4000-8000-00000000000f', '5e540000-0000-4000-8000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('5e543000-0000-4000-8000-00000000000f', '5ea40000-0000-4000-8000-00000000000f', 'self');

-- Autoridad para crear sesiones (calca el test de move): capability al ayudante.
update public.capabilities set granted = true
  where membership_id = '5e545000-0000-4000-8000-00000000000d' and capability_name = 'can_create_sessions';

-- Dos ejercicios publicados: uno referenciado (Rondo), otro NO (Suelto).
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status, tactical_objectives) values
  ('5e94e000-0000-4000-8000-000000000001', '5ea40000-0000-4000-8000-00000000000d', '5e540000-0000-4000-8000-000000000001', 'Rondo',  'published', array['posesion']),
  ('5e94e000-0000-4000-8000-000000000002', '5ea40000-0000-4000-8000-00000000000d', '5e540000-0000-4000-8000-000000000001', 'Suelto', 'published', '{}');
alter table public.exercises enable trigger trg_exercises_validate;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5ea40000-0000-4000-8000-00000000000d","role":"authenticated"}';

-- a1 PUBLICADA (visibility=team) con Rondo en el calentamiento; a2 BORRADOR (staff).
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date, visibility) values
  ('5e500000-0000-4000-8000-0000000000a1', '5ea40000-0000-4000-8000-00000000000d', '5e540000-0000-4000-8000-000000000001', '5e542000-0000-4000-8000-000000000001', '2026-10-01', 'team'),
  ('5e500000-0000-4000-8000-0000000000a2', '5ea40000-0000-4000-8000-00000000000d', '5e540000-0000-4000-8000-000000000001', '5e542000-0000-4000-8000-000000000001', '2026-10-02', 'staff');

insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5e5b0000-0000-4000-8000-0000000000b1', '5e500000-0000-4000-8000-0000000000a1', '5e540000-0000-4000-8000-000000000001', 'calentamiento', 0),
  ('5e5b0000-0000-4000-8000-0000000000b2', '5e500000-0000-4000-8000-0000000000a2', '5e540000-0000-4000-8000-000000000001', 'calentamiento', 0);

insert into public.session_block_exercises (id, block_id, exercise_id, order_idx) values
  ('5e5e0000-0000-4000-8000-0000000000c1', '5e5b0000-0000-4000-8000-0000000000b1', '5e94e000-0000-4000-8000-000000000001', 0),
  ('5e5e0000-0000-4000-8000-0000000000c2', '5e5b0000-0000-4000-8000-0000000000b2', '5e94e000-0000-4000-8000-000000000001', 0);

-- ── Como JUGADOR ─────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"5ea40000-0000-4000-8000-00000000000f","role":"authenticated"}';

-- T1: en la sesión PUBLICADA ve el nombre "Rondo" + su objetivo.
do $$
declare v_name text; v_tac text[];
begin
  select name, tactical_objectives into v_name, v_tac
    from public.session_exercise_meta('5e500000-0000-4000-8000-0000000000a1');
  if v_name is distinct from 'Rondo' then
    raise exception 'FAIL [T1]: jugador no ve el nombre (got %)', v_name;
  end if;
  if not (v_tac @> array['posesion']) then
    raise exception 'FAIL [T1]: jugador no ve el objetivo (got %)', v_tac;
  end if;
end $$;

-- T2: solo devuelve los ejercicios REFERENCIADOS (1 fila, no "Suelto").
do $$
declare v_count int;
begin
  select count(*) into v_count
    from public.session_exercise_meta('5e500000-0000-4000-8000-0000000000a1');
  if v_count <> 1 then
    raise exception 'FAIL [T2]: esperaba 1 ejercicio referenciado, got %', v_count;
  end if;
end $$;

-- T3: en la sesión BORRADOR (staff) el jugador NO obtiene nada (0 filas).
do $$
declare v_count int;
begin
  select count(*) into v_count
    from public.session_exercise_meta('5e500000-0000-4000-8000-0000000000a2');
  if v_count <> 0 then
    raise exception 'FAIL [T3]: jugador vio meta de una sesión borrador (got % filas)', v_count;
  end if;
end $$;

-- ── Como STAFF ───────────────────────────────────────────────────────────────
-- T4: el staff sí ve la meta de la sesión borrador (gate user_can_see_session).
do $$
declare v_name text;
begin
  set local "request.jwt.claims" = '{"sub":"5ea40000-0000-4000-8000-00000000000d","role":"authenticated"}';
  select name into v_name
    from public.session_exercise_meta('5e500000-0000-4000-8000-0000000000a2');
  if v_name is distinct from 'Rondo' then
    raise exception 'FAIL [T4]: el staff no ve la meta del borrador (got %)', v_name;
  end if;
end $$;

reset role;

rollback;
