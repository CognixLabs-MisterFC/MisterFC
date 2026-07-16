-- Tests JS-0 (F12↔F13, #192) — RLS, autoridad, trigger y total derivado de
-- `session_block_plays` (jugadas en una sesión). Migración 20260810000000.
--
-- Cubre:
--   · INSERT/CRUD por staff de la sesión (principal owner) + derivación de
--     session_id/club_id del bloque.
--   · INSERT rechaza una jugada que NO está en el playbook del equipo de la sesión.
--   · INSERT rechaza jugadas en una PLANTILLA (sin team → sin playbook, D4).
--   · SELECT: familia (D6 estricta) ve la sesión 'team' pero SOLO las jugadas
--     shared_with_family; staff ve todas; jugador de OTRO equipo no ve nada.
--   · D8: total_minutes = suma de ejercicios ∪ jugadas; recalcula al insertar/
--     editar/borrar jugadas.
--   · reorder_session_block_plays; mover intra-sesión OK; cross-session bloqueado.
--   · familia no puede editar/borrar.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5cc00000-0000-4000-8000-000000000001', 'Club SBP A', 'club-sbp-a');

insert into public.categories (id, club_id, name) values
  ('5cca0000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000001', 'Cat A'),
  ('5cca0000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('5c700000-0000-4000-8000-000000000001', '5cca0000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('5c700000-0000-4000-8000-000000000002', '5cca0000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

-- jugadorF en Team A (familia f); jugador9 en Team A2 (familia 9, OTRO equipo).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5c500000-0000-4000-8000-00000000000f', '5cc00000-0000-4000-8000-000000000001', 'Fede', 'Team', '2012-01-01'),
  ('5c500000-0000-4000-8000-000000000009', '5cc00000-0000-4000-8000-000000000001', 'Gael', 'Otro', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('5c700000-0000-4000-8000-000000000001', '5c500000-0000-4000-8000-00000000000f', '2025-09-01'),
  ('5c700000-0000-4000-8000-000000000002', '5c500000-0000-4000-8000-000000000009', '2025-09-01');

select pg_temp.new_test_user('5ca00000-0000-4000-8000-00000000000a', 'admin@sbp.test', '{}'::jsonb);
select pg_temp.new_test_user('5ca00000-0000-4000-8000-00000000000c', 'principal@sbp.test', '{}'::jsonb);
select pg_temp.new_test_user('5ca00000-0000-4000-8000-00000000000f', 'jugF@sbp.test', '{}'::jsonb);
select pg_temp.new_test_user('5ca00000-0000-4000-8000-000000000009', 'jug9@sbp.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('5c550000-0000-4000-8000-00000000000a', '5ca00000-0000-4000-8000-00000000000a', '5cc00000-0000-4000-8000-000000000001', 'admin_club'),
  ('5c550000-0000-4000-8000-00000000000c', '5ca00000-0000-4000-8000-00000000000c', '5cc00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('5c550000-0000-4000-8000-00000000000f', '5ca00000-0000-4000-8000-00000000000f', '5cc00000-0000-4000-8000-000000000001', 'jugador'),
  ('5c550000-0000-4000-8000-000000000009', '5ca00000-0000-4000-8000-000000000009', '5cc00000-0000-4000-8000-000000000001', 'jugador');

-- Principal en team_staff de Team A (autoridad de creación/edición vía rol de team).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('5c700000-0000-4000-8000-000000000001', '5c550000-0000-4000-8000-00000000000c', 'entrenador_principal');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('5c500000-0000-4000-8000-00000000000f', '5ca00000-0000-4000-8000-00000000000f', 'self'),
  ('5c500000-0000-4000-8000-000000000009', '5ca00000-0000-4000-8000-000000000009', 'self');

-- Un ejercicio del club para mezclar en total_minutes (trigger off, sin ciclo).
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('5c9e0000-0000-4000-8000-000000000001', '5ca00000-0000-4000-8000-00000000000a', '5cc00000-0000-4000-8000-000000000001', 'Rondo 5v2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

-- Jugadas del banco (published). P1/P2 irán al playbook del Team A; P3 NO.
alter table public.plays disable trigger trg_plays_validate;
insert into public.plays (id, owner_profile_id, club_id, name, play, status) values
  ('5c910000-0000-4000-8000-0000000000b1', '5ca00000-0000-4000-8000-00000000000c', '5cc00000-0000-4000-8000-000000000001', 'Play P1', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published'),
  ('5c910000-0000-4000-8000-0000000000b2', '5ca00000-0000-4000-8000-00000000000c', '5cc00000-0000-4000-8000-000000000001', 'Play P2', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published'),
  ('5c910000-0000-4000-8000-0000000000b3', '5ca00000-0000-4000-8000-00000000000c', '5cc00000-0000-4000-8000-000000000001', 'Play P3', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published');
alter table public.plays enable trigger trg_plays_validate;

-- Playbook del Team A: P1 compartida con familia, P2 NO. (P3 fuera del playbook.)
alter table public.team_plays disable trigger trg_team_plays_validate;
insert into public.team_plays (id, club_id, team_id, play_id, shared_with_family) values
  ('5c710000-0000-4000-8000-0000000000b1', '5cc00000-0000-4000-8000-000000000001', '5c700000-0000-4000-8000-000000000001', '5c910000-0000-4000-8000-0000000000b1', true),
  ('5c710000-0000-4000-8000-0000000000b2', '5cc00000-0000-4000-8000-000000000001', '5c700000-0000-4000-8000-000000000001', '5c910000-0000-4000-8000-0000000000b2', false);
alter table public.team_plays enable trigger trg_team_plays_validate;

-- Sesiones: team (visible al equipo) + plantilla (sin equipo). Owner = principal.
alter table public.sessions disable trigger trg_sessions_validate;
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date, visibility, is_template) values
  ('5c5a0000-0000-4000-8000-0000000000c2', '5ca00000-0000-4000-8000-00000000000c', '5cc00000-0000-4000-8000-000000000001', '5c700000-0000-4000-8000-000000000001', '2026-10-02', 'team',  false),
  ('5c5a0000-0000-4000-8000-0000000000c3', '5ca00000-0000-4000-8000-00000000000a', '5cc00000-0000-4000-8000-000000000001', null, null, 'staff', true);
alter table public.sessions enable trigger trg_sessions_validate;

-- Bloques: 2 en la sesión team (para mover intra-sesión) + 1 en la plantilla.
insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5c5b0000-0000-4000-8000-0000000000c2', '5c5a0000-0000-4000-8000-0000000000c2', '5cc00000-0000-4000-8000-000000000001', 'principal',     0),
  ('5c5b0000-0000-4000-8000-0000000000d2', '5c5a0000-0000-4000-8000-0000000000c2', '5cc00000-0000-4000-8000-000000000001', 'complementaria', 1),
  ('5c5b0000-0000-4000-8000-0000000000c3', '5c5a0000-0000-4000-8000-0000000000c3', '5cc00000-0000-4000-8000-000000000001', 'principal',     0);

-- Un ejercicio en la sesión team con 20 min → total_minutes = 20 (semilla del mix).
insert into public.session_block_exercises (id, block_id, session_id, club_id, exercise_id, order_idx, duration_min) values
  ('5c5e0000-0000-4000-8000-0000000000c2', '5c5b0000-0000-4000-8000-0000000000c2', '5c5a0000-0000-4000-8000-0000000000c2', '5cc00000-0000-4000-8000-000000000001', '5c9e0000-0000-4000-8000-000000000001', 0, 20);

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT / CRUD (staff de la sesión = principal owner)
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- P1: principal inserta P1 (en el playbook) en blockTeam, duration 10. Pasa
-- session_id/club_id EQUIVOCADOS a propósito → el trigger los deriva del bloque.
do $$
declare v_session uuid; v_club uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.session_block_plays (id, block_id, session_id, club_id, play_id, order_idx, duration_min)
  values ('5c5f0000-0000-4000-8000-000000000001', '5c5b0000-0000-4000-8000-0000000000c2',
          '5c5a0000-0000-4000-8000-0000000000c3', '5cc00000-0000-4000-8000-000000000001',  -- session/club erróneos
          '5c910000-0000-4000-8000-0000000000b1', 0, 10);
  select session_id, club_id into v_session, v_club
    from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000001';
  if v_session <> '5c5a0000-0000-4000-8000-0000000000c2'
     or v_club <> '5cc00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [P1]: no se derivaron session_id/club_id del bloque (% / %)', v_session, v_club;
  end if;
end $$;

-- T1: total_minutes recalculó al insertar P1 → 20 (ejercicio) + 10 = 30
do $$
declare t int;
begin
  select total_minutes into t from public.sessions where id = '5c5a0000-0000-4000-8000-0000000000c2';
  if t <> 30 then raise exception 'FAIL [T1]: total tras insertar P1 = % (esperado 30)', t; end if;
end $$;

-- P2: principal inserta P2 (en playbook, NO compartida) en blockTeam, duration 5.
do $$
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.session_block_plays (id, block_id, play_id, order_idx, duration_min)
  values ('5c5f0000-0000-4000-8000-000000000002', '5c5b0000-0000-4000-8000-0000000000c2',
          '5c910000-0000-4000-8000-0000000000b2', 1, 5);
exception when others then
  raise exception 'FAIL [P2]: principal no pudo añadir P2 (en playbook): %', sqlerrm;
end $$;

-- T2: total tras P2 → 20 + 10 + 5 = 35
do $$
declare t int;
begin
  select total_minutes into t from public.sessions where id = '5c5a0000-0000-4000-8000-0000000000c2';
  if t <> 35 then raise exception 'FAIL [T2]: total tras insertar P2 = % (esperado 35)', t; end if;
end $$;

-- R1: insertar P3 (NO está en el playbook del equipo) → RLS rechaza
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    insert into public.session_block_plays (block_id, play_id, order_idx)
    values ('5c5b0000-0000-4000-8000-0000000000c2', '5c910000-0000-4000-8000-0000000000b3', 2);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [R1]: se añadió una jugada fuera del playbook del equipo'; end if;
end $$;

-- R2: insertar una jugada en una PLANTILLA (sin team → sin playbook, D4) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000a","role":"authenticated"}';  -- admin (puede editar plantilla)
  begin
    insert into public.session_block_plays (block_id, play_id, order_idx)
    values ('5c5b0000-0000-4000-8000-0000000000c3', '5c910000-0000-4000-8000-0000000000b1', 0);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [R2]: se añadió una jugada a una plantilla (sin equipo)'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por rol / visibilidad (D6 estricta)
-- ─────────────────────────────────────────────────────────────────────────────

-- SF: familia del Team A ve la sesión 'team' pero SOLO la jugada compartida (P1).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.session_block_plays
   where session_id = '5c5a0000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [SF-a]: la familia ve % jugadas (esperado 1: solo la compartida)', n; end if;
  select count(*) into n from public.session_block_plays
   where session_id = '5c5a0000-0000-4000-8000-0000000000c2'
     and play_id = '5c910000-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FAIL [SF-b]: la familia no ve la jugada compartida P1'; end if;
  select count(*) into n from public.session_block_plays
   where play_id = '5c910000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'FAIL [SF-c]: la familia ve la jugada NO compartida P2'; end if;
end $$;

-- SS: staff (principal) ve las 2 jugadas de la sesión.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.session_block_plays
   where session_id = '5c5a0000-0000-4000-8000-0000000000c2';
  if n <> 2 then raise exception 'FAIL [SS]: el staff ve % jugadas (esperado 2)', n; end if;
end $$;

-- SO: jugador de OTRO equipo (9) no ve nada (no ve la sesión).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-000000000009","role":"authenticated"}';
  select count(*) into n from public.session_block_plays
   where session_id = '5c5a0000-0000-4000-8000-0000000000c2';
  if n <> 0 then raise exception 'FAIL [SO]: jugador de otro equipo ve % jugadas (esperado 0)', n; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / total / reorder / move / delete
-- ─────────────────────────────────────────────────────────────────────────────

-- U1: principal edita duration de P1 (10→15); play_id sigue en el playbook → OK.
do $$
declare n int; t int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.session_block_plays set duration_min = 15 where id = '5c5f0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U1]: principal no pudo editar la jugada'; end if;
  select total_minutes into t from public.sessions where id = '5c5a0000-0000-4000-8000-0000000000c2';
  if t <> 40 then raise exception 'FAIL [U1b]: total tras editar P1 = % (esperado 40)', t; end if;
end $$;

-- RE: reordenar las jugadas del bloque → [P2, P1]; P2 pasa a order 0, P1 a order 1.
do $$
declare o1 int; o2 int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  perform public.reorder_session_block_plays(
    '5c5b0000-0000-4000-8000-0000000000c2',
    array['5c5f0000-0000-4000-8000-000000000002','5c5f0000-0000-4000-8000-000000000001']::uuid[]);
  select order_idx into o1 from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000001';
  select order_idx into o2 from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000002';
  if o2 <> 0 or o1 <> 1 then raise exception 'FAIL [RE]: reorder dejó P2=% P1=% (esperado 0/1)', o2, o1; end if;
end $$;

-- MV: mover P1 a otro bloque de la MISMA sesión (block2) → OK (trigger lo permite).
do $$
declare v_block uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.session_block_plays set block_id = '5c5b0000-0000-4000-8000-0000000000d2', order_idx = 0
   where id = '5c5f0000-0000-4000-8000-000000000001';
  select block_id into v_block from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000001';
  if v_block <> '5c5b0000-0000-4000-8000-0000000000d2' then raise exception 'FAIL [MV]: no se movió intra-sesión'; end if;
end $$;

-- XS: mover P1 a un bloque de OTRA sesión (la plantilla) → trigger lo bloquea.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    update public.session_block_plays set block_id = '5c5b0000-0000-4000-8000-0000000000c3'
     where id = '5c5f0000-0000-4000-8000-000000000001';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [XS]: se pudo mover una jugada a otra sesión'; end if;
end $$;

-- FE: la familia NO puede editar ni borrar (user_can_edit_session = false) → 0 filas.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  update public.session_block_plays set duration_min = 99 where id = '5c5f0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [FE-a]: la familia pudo editar una jugada'; end if;
  delete from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [FE-b]: la familia pudo borrar una jugada'; end if;
end $$;

-- DL: principal borra P2 → OK + total recalcula a 20 (ejercicio) + 15 (P1) = 35.
do $$
declare n int; t int;
begin
  set local "request.jwt.claims" = '{"sub":"5ca00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.session_block_plays where id = '5c5f0000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [DL]: principal no pudo borrar P2'; end if;
  select total_minutes into t from public.sessions where id = '5c5a0000-0000-4000-8000-0000000000c2';
  if t <> 35 then raise exception 'FAIL [DLb]: total tras borrar P2 = % (esperado 35)', t; end if;
end $$;

reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS session_block_plays (jugadas en sesión) pasaron.'
\echo '──────────────────────────────────────────────'
