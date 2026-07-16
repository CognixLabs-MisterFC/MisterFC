-- Tests F12.6 — clone_session (migración 20260720000000_session_clone.sql).
--
-- Cubre las DOS direcciones del clonado + el gate RLS:
--   · GUARDAR COMO PLANTILLA: sesión real → clon is_template=true, sin fecha/equipo,
--     visibility='staff', con sus bloques + tareas (overrides) copiados; total derivado.
--   · CREAR DESDE PLANTILLA: plantilla → clon is_template=false con fecha+equipo dados,
--     copiando bloques + tareas SIN sembrar el esqueleto (mismo nº de bloques).
--   · RLS: un jugador (no editor) no puede clonar (source no visible / no autoridad).
--
-- Estilo: aserciones con raise exception. Transaccional.
-- IDs (último segmento HEX): owner d, jugador f; sesión real a1; plantilla destino t1;
-- bloques b1/b2; tareas c1/c2; ejercicios e1/e2; equipo destino al crear desde plantilla.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('c10c0000-0000-4000-8000-000000000001', 'Club Clone', 'club-clone');
insert into public.categories (id, club_id, name, kind) values
  ('c10c1000-0000-4000-8000-000000000001', 'c10c0000-0000-4000-8000-000000000001', 'Infantil', 'infantil');
insert into public.teams (id, category_id, name, format, color, season) values
  ('c10c2000-0000-4000-8000-000000000001', 'c10c1000-0000-4000-8000-000000000001', 'Team C', 'F11', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c10c3000-0000-4000-8000-00000000000f', 'c10c0000-0000-4000-8000-000000000001', 'Fede', 'C', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('c10c2000-0000-4000-8000-000000000001', 'c10c3000-0000-4000-8000-00000000000f', '2025-09-01');

select pg_temp.new_test_user('c1a60000-0000-4000-8000-00000000000d', 'owner@clone.test', '{}'::jsonb);
select pg_temp.new_test_user('c1a60000-0000-4000-8000-00000000000f', 'jug@clone.test', '{}'::jsonb);
insert into public.memberships (id, profile_id, club_id, role) values
  ('c10c5000-0000-4000-8000-00000000000d', 'c1a60000-0000-4000-8000-00000000000d', 'c10c0000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('c10c5000-0000-4000-8000-00000000000f', 'c1a60000-0000-4000-8000-00000000000f', 'c10c0000-0000-4000-8000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('c10c3000-0000-4000-8000-00000000000f', 'c1a60000-0000-4000-8000-00000000000f', 'self');

update public.capabilities set granted = true
  where membership_id = 'c10c5000-0000-4000-8000-00000000000d' and capability_name = 'can_create_sessions';

alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('c196e000-0000-4000-8000-000000000001', 'c1a60000-0000-4000-8000-00000000000d', 'c10c0000-0000-4000-8000-000000000001', 'Ej 1', 'published'),
  ('c196e000-0000-4000-8000-000000000002', 'c1a60000-0000-4000-8000-00000000000d', 'c10c0000-0000-4000-8000-000000000001', 'Ej 2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

-- Sesión REAL (owner d): equipo + fecha + objetivos + 2 bloques + 2 tareas (con overrides).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1a60000-0000-4000-8000-00000000000d","role":"authenticated"}';

insert into public.sessions
  (id, owner_profile_id, club_id, team_id, session_date, title, objective_physical,
   tactical_objectives, technical_objectives, mesocycle, microcycle, visibility)
values
  ('c1500000-0000-4000-8000-0000000000a1', 'c1a60000-0000-4000-8000-00000000000d',
   'c10c0000-0000-4000-8000-000000000001', 'c10c2000-0000-4000-8000-000000000001',
   '2026-10-01', 'Sesión base', 'Resistencia',
   array['posesion']::text[], array['pase']::text[], 'Meso 1', 'Micro 3', 'team');

insert into public.session_blocks (id, session_id, club_id, block_type, title, order_idx) values
  ('c15b0000-0000-4000-8000-0000000000b1', 'c1500000-0000-4000-8000-0000000000a1', 'c10c0000-0000-4000-8000-000000000001', 'calentamiento', 'Activación', 0),
  ('c15b0000-0000-4000-8000-0000000000b2', 'c1500000-0000-4000-8000-0000000000a1', 'c10c0000-0000-4000-8000-000000000001', 'principal',     null,         1);

insert into public.session_block_exercises (id, block_id, exercise_id, order_idx, duration_min, series, notes) values
  ('c15e0000-0000-4000-8000-0000000000c1', 'c15b0000-0000-4000-8000-0000000000b1', 'c196e000-0000-4000-8000-000000000001', 0, 10, null,    'suave'),
  ('c15e0000-0000-4000-8000-0000000000c2', 'c15b0000-0000-4000-8000-0000000000b2', 'c196e000-0000-4000-8000-000000000002', 0, 20, '2 x 8''', null);

-- ── T-tpl: guardar COMO plantilla → is_template, sin fecha/equipo, visibility staff ──
do $$
declare
  v_tpl uuid;
  r record;
  v_blocks int; v_tasks int;
begin
  v_tpl := public.clone_session('c1500000-0000-4000-8000-0000000000a1', true, 'Mi plantilla');

  select is_template, session_date, team_id, visibility, title,
         objective_physical, tactical_objectives, technical_objectives, mesocycle
    into r
    from public.sessions where id = v_tpl;

  if not r.is_template then raise exception 'FAIL [tpl-1]: clon no es plantilla'; end if;
  if r.session_date is not null then raise exception 'FAIL [tpl-2]: plantilla con fecha %', r.session_date; end if;
  if r.team_id is not null then raise exception 'FAIL [tpl-3]: plantilla con equipo'; end if;
  if r.visibility <> 'staff' then raise exception 'FAIL [tpl-4]: plantilla visibility %', r.visibility; end if;
  if r.title <> 'Mi plantilla' then raise exception 'FAIL [tpl-5]: título = % (esperaba override)', r.title; end if;
  if r.objective_physical <> 'Resistencia' then raise exception 'FAIL [tpl-6]: objetivo físico no copiado'; end if;
  if r.tactical_objectives <> array['posesion']::text[] then raise exception 'FAIL [tpl-7]: tácticos no copiados'; end if;
  if r.technical_objectives <> array['pase']::text[] then raise exception 'FAIL [tpl-8]: técnicos no copiados'; end if;
  if r.mesocycle <> 'Meso 1' then raise exception 'FAIL [tpl-9]: meso no copiado'; end if;

  -- Estructura copiada: 2 bloques, 2 tareas, con overrides + total derivado (30).
  select count(*) into v_blocks from public.session_blocks where session_id = v_tpl;
  if v_blocks <> 2 then raise exception 'FAIL [tpl-10]: % bloques (esperaba 2)', v_blocks; end if;

  select count(*) into v_tasks from public.session_block_exercises where session_id = v_tpl;
  if v_tasks <> 2 then raise exception 'FAIL [tpl-11]: % tareas (esperaba 2)', v_tasks; end if;

  -- El override "2 x 8'" del bloque principal debe haberse copiado.
  perform 1 from public.session_block_exercises e
    join public.session_blocks b on b.id = e.block_id
   where b.session_id = v_tpl and e.series = '2 x 8''' and e.duration_min = 20;
  if not found then raise exception 'FAIL [tpl-12]: override series/duración no copiado'; end if;

  select total_minutes into v_tasks from public.sessions where id = v_tpl;
  if v_tasks is distinct from 30 then raise exception 'FAIL [tpl-13]: total = % (esperaba 30)', v_tasks; end if;
end $$;

-- ── T-from: crear DESDE plantilla → sesión real con fecha+equipo, sin sembrar ────────
do $$
declare
  v_tpl uuid;
  v_ses uuid;
  v_blocks int;
  r record;
begin
  v_tpl := public.clone_session('c1500000-0000-4000-8000-0000000000a1', true, 'Plantilla origen');
  v_ses := public.clone_session(
    v_tpl, false, null, '2026-11-05', 'c10c2000-0000-4000-8000-000000000001'
  );

  select is_template, session_date, team_id, visibility, title into r
    from public.sessions where id = v_ses;

  if r.is_template then raise exception 'FAIL [from-1]: clon es plantilla (esperaba sesión real)'; end if;
  if r.session_date is distinct from date '2026-11-05' then raise exception 'FAIL [from-2]: fecha = %', r.session_date; end if;
  if r.team_id is distinct from 'c10c2000-0000-4000-8000-000000000001'::uuid then raise exception 'FAIL [from-3]: equipo no asignado'; end if;
  if r.visibility <> 'staff' then raise exception 'FAIL [from-4]: arranca publicada (visibility %)', r.visibility; end if;
  if r.title <> 'Plantilla origen' then raise exception 'FAIL [from-5]: título no heredado de la plantilla (%)', r.title; end if;

  -- NO se siembra el esqueleto: copia los bloques de la plantilla (2), no 5.
  select count(*) into v_blocks from public.session_blocks where session_id = v_ses;
  if v_blocks <> 2 then raise exception 'FAIL [from-6]: % bloques (esperaba 2, sin sembrar)', v_blocks; end if;
end $$;

-- ── T-rls: el jugador no puede clonar (no ve plantillas / sin autoridad) ─────────────
do $$
declare v_err text;
begin
  set local "request.jwt.claims" = '{"sub":"c1a60000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    perform public.clone_session('c1500000-0000-4000-8000-0000000000a1', true, 'Hack');
    raise exception 'FAIL [rls-clone]: el jugador clonó una sesión';
  exception
    when others then
      -- Esperado: RLS de SELECT no devuelve el origen (clone_source_not_found) o RLS
      -- de INSERT lo bloquea (42501). Cualquier error ≠ el FAIL anterior es OK.
      get stacked diagnostics v_err = message_text;
      if v_err = 'FAIL [rls-clone]: el jugador clonó una sesión' then raise; end if;
  end;
end $$;

reset role;

rollback;
