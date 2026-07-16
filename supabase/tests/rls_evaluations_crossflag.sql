-- Tests F8.6 — cruce del flag de visibilidad afectando A LA VEZ a la valoración
-- INDIVIDUAL (evaluations) y a la COLECTIVA (team_evaluations).
--
-- El flag club_settings.evaluations_player_visibility es la ÚNICA fuente de verdad
-- (spec §6): se evalúa en cada SELECT vía club_evaluations_visible(club_id). Al
-- activarlo, jugador/familia ven retroactivamente ambas valoraciones; al
-- desactivarlo, dejan de verlas de inmediato (no hay copia materializada). Este
-- barrido comprueba el toggle ON→OFF→ON sobre las DOS tablas con un único fixture.
--
-- Convención del repo (ver rls_evaluations.sql): psql ON_ERROR_STOP=1; bloques que
-- deben fallar envueltos en DO con EXCEPTION; todo en BEGIN/ROLLBACK (no deja rastro).
--
-- Casos (jugador self p1 + familia parent p1, sobre un partido de su equipo):
--   X0. sin fila en club_settings (OFF por defecto): individual=0 y colectiva=0.
--   X1. admin activa el flag (ON): individual=1 y colectiva=1 (ambas, a la vez).
--   X2. admin desactiva el flag (OFF): individual=0 y colectiva=0 (revocación inmediata).
--   X3. staff (principal) ve ambas SIEMPRE (no depende del flag).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('77f80000-0000-0000-0000-000000000001', 'Club F86', 'club-f86');

select pg_temp.new_test_user('77f80000-aaaa-0001-0000-000000000000', 'admin-f86@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('77f80000-aaaa-0002-0000-000000000000', 'principal-f86@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('77f80000-aaaa-0004-0000-000000000000', 'jugador-f86@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('77f80000-aaaa-0005-0000-000000000000', 'familia-f86@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('77f80000-5550-0001-0000-000000000000', '77f80000-aaaa-0001-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'admin_club'),
  ('77f80000-5550-0002-0000-000000000000', '77f80000-aaaa-0002-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('77f80000-5550-0004-0000-000000000000', '77f80000-aaaa-0004-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'jugador'),
  ('77f80000-5550-0005-0000-000000000000', '77f80000-aaaa-0005-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'jugador');

insert into public.categories (id, club_id, name) values
  ('77f80000-0dd0-0001-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'Cat F86');

insert into public.teams (id, category_id, name, format, color, season) values
  ('77f80000-0ee1-0001-0000-000000000000', '77f80000-0dd0-0001-0000-000000000000', 'Team 1', 'F7', '#0EA5E9', '2025-26');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('77f80000-0ee1-0001-0000-000000000000', '77f80000-5550-0002-0000-000000000000', 'entrenador_principal');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('77f80000-0c00-0001-0000-000000000000', '77f80000-0000-0000-0000-000000000001', 'Pau', 'Uno', '2010-01-01');

insert into public.team_members (player_id, team_id, joined_at) values
  ('77f80000-0c00-0001-0000-000000000000', '77f80000-0ee1-0001-0000-000000000000', '2025-08-01');

-- jugador-f86 = self de p1; familia-f86 = parent de p1.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('77f80000-0c00-0001-0000-000000000000', '77f80000-aaaa-0004-0000-000000000000', 'self'),
  ('77f80000-0c00-0001-0000-000000000000', '77f80000-aaaa-0005-0000-000000000000', 'parent');

insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77f80000-0ee0-0001-0000-000000000000', '77f80000-0000-0000-0000-000000000001', '77f80000-0ee1-0001-0000-000000000000', 'match', 'Partido', '2026-03-01 10:00:00+00', '77f80000-aaaa-0002-0000-000000000000');

-- Sembrar (superuser, RLS bypass) la valoración individual de p1 y la colectiva.
insert into public.evaluations (event_id, player_id, rating, comment, created_by)
  values ('77f80000-0ee0-0001-0000-000000000000', '77f80000-0c00-0001-0000-000000000000', 8, 'buen partido', '77f80000-aaaa-0002-0000-000000000000');
insert into public.team_evaluations (event_id, rating, comment, created_by)
  values ('77f80000-0ee0-0001-0000-000000000000', 7, 'buen bloque', '77f80000-aaaa-0002-0000-000000000000');

-- Helper de aserción: cuenta lo que ve el rol actual en AMBAS tablas y compara.
-- (se inlinea en cada bloque para no depender de funciones; ver más abajo).

-- ── X0. Sin fila en club_settings → OFF por defecto: individual=0 y colectiva=0 ──
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0004-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 0 or n_col <> 0 then
    raise exception 'FAIL [X0]: jugador con flag OFF debería ver 0/0 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0005-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 0 or n_col <> 0 then
    raise exception 'FAIL [X0]: familia con flag OFF debería ver 0/0 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;

-- activar el flag (admin del club).
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.club_settings (club_id, evaluations_player_visibility)
    values ('77f80000-0000-0000-0000-000000000001', true);
exception when insufficient_privilege then
  raise exception 'FAIL [setup X1]: admin debería poder activar la visibilidad';
end $$;
reset role;

-- ── X1. flag ON → jugador y familia ven AMBAS (individual=1 y colectiva=1) ───────
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0004-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 1 or n_col <> 1 then
    raise exception 'FAIL [X1]: jugador con flag ON debería ver 1/1 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0005-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 1 or n_col <> 1 then
    raise exception 'FAIL [X1]: familia con flag ON debería ver 1/1 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;

-- desactivar el flag (admin del club).
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0001-0000-000000000000';
do $$ begin
  update public.club_settings set evaluations_player_visibility = false
    where club_id = '77f80000-0000-0000-0000-000000000001';
exception when insufficient_privilege then
  raise exception 'FAIL [setup X2]: admin debería poder desactivar la visibilidad';
end $$;
reset role;

-- ── X2. flag OFF de nuevo → revocación inmediata: individual=0 y colectiva=0 ─────
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0004-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 0 or n_col <> 0 then
    raise exception 'FAIL [X2]: jugador tras desactivar debería ver 0/0 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0005-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 0 or n_col <> 0 then
    raise exception 'FAIL [X2]: familia tras desactivar debería ver 0/0 (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;

-- ── X3. staff (principal) ve AMBAS siempre (con flag OFF) → individual=1 y colectiva=1
set local role authenticated;
set local "request.jwt.claim.sub" to '77f80000-aaaa-0002-0000-000000000000';
do $$
declare n_ind int; n_col int;
begin
  select count(*) into n_ind from public.evaluations      where event_id = '77f80000-0ee0-0001-0000-000000000000';
  select count(*) into n_col from public.team_evaluations where event_id = '77f80000-0ee0-0001-0000-000000000000';
  if n_ind <> 1 or n_col <> 1 then
    raise exception 'FAIL [X3]: staff debería ver 1/1 sin depender del flag (got ind=%, col=%)', n_ind, n_col;
  end if;
end $$;
reset role;

rollback;
