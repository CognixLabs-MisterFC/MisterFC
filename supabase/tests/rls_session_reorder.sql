-- Tests F12.2b — reorder_session_blocks / reorder_session_tasks + total derivado
-- (migración 20260717000000_session_reorder_total.sql).
--
-- Cubre: reordenar bloques y tareas en una sentencia sin violar el UNIQUE de orden
-- (deferrable); total_minutes recalculado por trigger al insertar/editar/borrar
-- tareas; y que un no-editor (jugador) no puede reordenar (RLS = gate).
--
-- Estilo: aserciones con raise exception. Transaccional.
-- IDs (último segmento, todo HEX): owner d, jugador f; sesión a1; bloques b1/b2/b3;
-- tareas c1/c2/c3; ejercicios e1/e2/e3.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5e560000-0000-4000-8000-000000000001', 'Club Reord', 'club-reord');
insert into public.categories (id, club_id, name, kind) values
  ('5e561000-0000-4000-8000-000000000001', '5e560000-0000-4000-8000-000000000001', 'Infantil', 'infantil');
insert into public.teams (id, category_id, name, format, color, season) values
  ('5e562000-0000-4000-8000-000000000001', '5e561000-0000-4000-8000-000000000001', 'Team R', 'F11', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5e563000-0000-4000-8000-00000000000f', '5e560000-0000-4000-8000-000000000001', 'Fede', 'R', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('5e562000-0000-4000-8000-000000000001', '5e563000-0000-4000-8000-00000000000f', '2025-09-01');

select pg_temp.new_test_user('5ea60000-0000-4000-8000-00000000000d', 'owner@reord.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea60000-0000-4000-8000-00000000000f', 'jug@reord.test', '{}'::jsonb);
insert into public.memberships (id, profile_id, club_id, role) values
  ('5e565000-0000-4000-8000-00000000000d', '5ea60000-0000-4000-8000-00000000000d', '5e560000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5e565000-0000-4000-8000-00000000000f', '5ea60000-0000-4000-8000-00000000000f', '5e560000-0000-4000-8000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('5e563000-0000-4000-8000-00000000000f', '5ea60000-0000-4000-8000-00000000000f', 'self');

update public.capabilities set granted = true
  where membership_id = '5e565000-0000-4000-8000-00000000000d' and capability_name = 'can_create_sessions';

-- Ejercicios para las tareas.
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('5e96e000-0000-4000-8000-000000000001', '5ea60000-0000-4000-8000-00000000000d', '5e560000-0000-4000-8000-000000000001', 'Ej 1', 'published'),
  ('5e96e000-0000-4000-8000-000000000002', '5ea60000-0000-4000-8000-00000000000d', '5e560000-0000-4000-8000-000000000001', 'Ej 2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

-- Sesión + 3 bloques + 2 tareas en el bloque b1 (como owner d, vía RLS).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5ea60000-0000-4000-8000-00000000000d","role":"authenticated"}';

insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date) values
  ('5e500000-0000-4000-8000-0000000000a1', '5ea60000-0000-4000-8000-00000000000d', '5e560000-0000-4000-8000-000000000001', '5e562000-0000-4000-8000-000000000001', '2026-10-01');

insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5e5b0000-0000-4000-8000-0000000000b1', '5e500000-0000-4000-8000-0000000000a1', '5e560000-0000-4000-8000-000000000001', 'calentamiento', 0),
  ('5e5b0000-0000-4000-8000-0000000000b2', '5e500000-0000-4000-8000-0000000000a1', '5e560000-0000-4000-8000-000000000001', 'principal',     1),
  ('5e5b0000-0000-4000-8000-0000000000b3', '5e500000-0000-4000-8000-0000000000a1', '5e560000-0000-4000-8000-000000000001', 'vuelta_a_la_calma', 2);

insert into public.session_block_exercises (id, block_id, exercise_id, order_idx, duration_min) values
  ('5e5e0000-0000-4000-8000-0000000000c1', '5e5b0000-0000-4000-8000-0000000000b1', '5e96e000-0000-4000-8000-000000000001', 0, 10),
  ('5e5e0000-0000-4000-8000-0000000000c2', '5e5b0000-0000-4000-8000-0000000000b1', '5e96e000-0000-4000-8000-000000000002', 1, 20);

-- ── T-total-1: tras insertar 10 + 20, total_minutes = 30 (trigger) ───────────
do $$
declare v int;
begin
  select total_minutes into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000a1';
  if v is distinct from 30 then raise exception 'FAIL [total-1]: total tras insertar = % (esperaba 30)', v; end if;
end $$;

-- ── T-reorder-blocks: invertir b3,b2,b1 → order 0,1,2 sin violar UNIQUE ───────
do $$
declare v0 int; v1 int; v2 int;
begin
  perform public.reorder_session_blocks(
    '5e500000-0000-4000-8000-0000000000a1',
    array['5e5b0000-0000-4000-8000-0000000000b3',
          '5e5b0000-0000-4000-8000-0000000000b2',
          '5e5b0000-0000-4000-8000-0000000000b1']::uuid[]
  );
  select order_idx into v0 from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000b3';
  select order_idx into v1 from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000b2';
  select order_idx into v2 from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000b1';
  if v0 <> 0 or v1 <> 1 or v2 <> 2 then
    raise exception 'FAIL [reorder-blocks]: order = %/%/% (esperaba 0/1/2)', v0, v1, v2;
  end if;
end $$;

-- ── T-reorder-tasks: invertir c2,c1 dentro de b1 ─────────────────────────────
do $$
declare va int; vb int;
begin
  perform public.reorder_session_tasks(
    '5e5b0000-0000-4000-8000-0000000000b1',
    array['5e5e0000-0000-4000-8000-0000000000c2',
          '5e5e0000-0000-4000-8000-0000000000c1']::uuid[]
  );
  select order_idx into va from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c2';
  select order_idx into vb from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c1';
  if va <> 0 or vb <> 1 then
    raise exception 'FAIL [reorder-tasks]: order = %/% (esperaba 0/1)', va, vb;
  end if;
end $$;

-- ── T-total-2: editar duration 20→15 → total 25; borrar c1(10) → total 15 ─────
do $$
declare v int;
begin
  update public.session_block_exercises set duration_min = 15 where id = '5e5e0000-0000-4000-8000-0000000000c2';
  select total_minutes into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000a1';
  if v is distinct from 25 then raise exception 'FAIL [total-2a]: total tras editar = % (esperaba 25)', v; end if;

  delete from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c1';
  select total_minutes into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000a1';
  if v is distinct from 15 then raise exception 'FAIL [total-2b]: total tras borrar = % (esperaba 15)', v; end if;
end $$;

-- ── T-rls: el jugador no puede reordenar (RLS) → el orden NO cambia ───────────
do $$
declare v0 int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea60000-0000-4000-8000-00000000000f","role":"authenticated"}';
  perform public.reorder_session_blocks(
    '5e500000-0000-4000-8000-0000000000a1',
    array['5e5b0000-0000-4000-8000-0000000000b1',
          '5e5b0000-0000-4000-8000-0000000000b2',
          '5e5b0000-0000-4000-8000-0000000000b3']::uuid[]
  );
  -- seguía siendo b3=0,b2=1,b1=2 del reorder anterior; el jugador no debe cambiarlo.
  select order_idx into v0 from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000b3';
  if v0 <> 0 then raise exception 'FAIL [rls-reorder]: el jugador reordenó (b3 quedó en %)', v0; end if;
end $$;

reset role;

rollback;
