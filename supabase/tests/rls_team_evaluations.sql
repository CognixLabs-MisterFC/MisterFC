-- Tests F8.3 — trigger y RLS de la valoración COLECTIVA del partido
-- (migración 20260623000000_team_evaluations.sql).
--
-- Convención del repo (ver rls_evaluations.sql): psql con ON_ERROR_STOP=1; cada
-- bloque que DEBE fallar se envuelve en DO con EXCEPTION capturando el SQLSTATE.
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--
-- Casos:
--   Trigger / constraints (superuser):
--     C1. team eval sobre TRAINING        → check_violation (event_not_a_match).
--     C2. rating 11                        → check_violation (CHECK).
--     C3. team eval sobre match (rating 7) → OK; club_id/team_id derivados.
--     C4. event_id inmutable en UPDATE     → check_violation.
--   RLS (role-switched):
--     R1. principal del team inserta       → OK; created_by forzado a auth.uid().
--     R2. jugador inserta                  → forbidden (42501).
--     R3. staff de OTRO team inserta       → forbidden.
--     R4. admin de OTRO club inserta       → forbidden.
--     R5. flag OFF: jugador y familia del team ven 0 filas.
--     R6. flag ON: jugador (self p1), familia (parent p1) y jugador de OTRO
--         jugador del mismo equipo (self p2) ven la colectiva (TEAM-scoped).
--     R7. flag ON: jugador de OTRO equipo/club NO la ve.

begin;

insert into public.clubs (id, name, slug) values
  ('99f90000-0000-0000-0000-000000000001', 'Club F83 A', 'club-f83-a'),
  ('99f90000-0000-0000-0000-000000000002', 'Club F83 B', 'club-f83-b');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('99f90000-aaaa-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f83-a@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('99f90000-aaaa-0002-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-f83-a@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99f90000-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-f83-a@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('99f90000-aaaa-0005-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'familia-f83-a@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('99f90000-aaaa-0008-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador2-f83-a@ts.test',  now(), '{}'::jsonb, now(), now()),
  ('99f90000-aaaa-0006-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff-team2-f83@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99f90000-bbbb-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f83-b@ts.test',     now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('99f90000-5550-0001-0000-000000000000', '99f90000-aaaa-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'admin_club'),
  ('99f90000-5550-0002-0000-000000000000', '99f90000-aaaa-0002-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99f90000-5550-0004-0000-000000000000', '99f90000-aaaa-0004-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'jugador'),
  ('99f90000-5550-0005-0000-000000000000', '99f90000-aaaa-0005-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'jugador'),
  ('99f90000-5550-0008-0000-000000000000', '99f90000-aaaa-0008-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'jugador'),
  ('99f90000-5550-0006-0000-000000000000', '99f90000-aaaa-0006-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99f90000-5550-0007-0000-000000000000', '99f90000-bbbb-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000002', 'admin_club');

insert into public.categories (id, club_id, name, season) values
  ('99f90000-0dd0-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'Cat F83 A', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('99f90000-0ee1-0001-0000-000000000000', '99f90000-0dd0-0001-0000-000000000000', 'Team 1', 'F7', '#0EA5E9'),
  ('99f90000-0ee1-0002-0000-000000000000', '99f90000-0dd0-0001-0000-000000000000', 'Team 2', 'F7', '#F59E0B');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('99f90000-0ee1-0001-0000-000000000000', '99f90000-5550-0002-0000-000000000000', 'entrenador_principal'),
  ('99f90000-0ee1-0002-0000-000000000000', '99f90000-5550-0006-0000-000000000000', 'entrenador_principal');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('99f90000-0c00-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'Pau',  'Uno', '2010-01-01'),
  ('99f90000-0c00-0002-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'Dani', 'Dos', '2010-02-02'),
  ('99f90000-0c00-0003-0000-000000000000', '99f90000-0000-0000-0000-000000000001', 'Iker', 'Tres','2010-03-03');

insert into public.team_members (player_id, team_id, joined_at) values
  ('99f90000-0c00-0001-0000-000000000000', '99f90000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('99f90000-0c00-0002-0000-000000000000', '99f90000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('99f90000-0c00-0003-0000-000000000000', '99f90000-0ee1-0002-0000-000000000000', '2025-08-01');

-- cuentas: jugador-a = self de p1; familia-a = parent de p1; jugador2-a = self de p2 (mismo team1).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('99f90000-0c00-0001-0000-000000000000', '99f90000-aaaa-0004-0000-000000000000', 'self'),
  ('99f90000-0c00-0001-0000-000000000000', '99f90000-aaaa-0005-0000-000000000000', 'parent'),
  ('99f90000-0c00-0002-0000-000000000000', '99f90000-aaaa-0008-0000-000000000000', 'self');

-- events: match (team1) + training (team1, negativo C1).
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('99f90000-0ee0-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000001', '99f90000-0ee1-0001-0000-000000000000', 'match',    'Partido', '2026-03-01 10:00:00+00', '99f90000-aaaa-0002-0000-000000000000'),
  ('99f90000-0ee0-0002-0000-000000000000', '99f90000-0000-0000-0000-000000000001', '99f90000-0ee1-0001-0000-000000000000', 'training', 'Entreno', '2026-03-05 18:00:00+00', '99f90000-aaaa-0002-0000-000000000000');

-- ── Trigger / constraints (superuser) ────────────────────────────────────────

-- C1. team eval sobre TRAINING → check_violation.
do $$ begin
  begin
    insert into public.team_evaluations (event_id, rating, created_by)
      values ('99f90000-0ee0-0002-0000-000000000000', 7, '99f90000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C1]: colectiva sobre entreno debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C2. rating 11 → check_violation.
do $$ begin
  begin
    insert into public.team_evaluations (event_id, rating, created_by)
      values ('99f90000-0ee0-0001-0000-000000000000', 11, '99f90000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C2]: rating 11 debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C3. team eval sobre match rating 7 → OK; club_id/team_id derivados (ignora lo pasado).
do $$
declare v_club uuid; v_team uuid;
begin
  insert into public.team_evaluations (event_id, club_id, team_id, rating, comment, created_by)
    values ('99f90000-0ee0-0001-0000-000000000000', '99f90000-0000-0000-0000-000000000002', '99f90000-0ee1-0002-0000-000000000000', 7, 'buen bloque', '99f90000-aaaa-0002-0000-000000000000')
    returning club_id, team_id into v_club, v_team;
  if v_club <> '99f90000-0000-0000-0000-000000000001' or v_team <> '99f90000-0ee1-0001-0000-000000000000' then
    raise exception 'FAIL [C3]: club_id/team_id deberían derivarse del evento (got %, %)', v_club, v_team;
  end if;
end $$;

-- C4. event_id inmutable en UPDATE → check_violation.
do $$ begin
  begin
    update public.team_evaluations set event_id = '99f90000-0ee0-0002-0000-000000000000'
      where event_id = '99f90000-0ee0-0001-0000-000000000000';
    raise exception 'FAIL [C4]: event_id no debería poder cambiar';
  exception when check_violation then null; end;
end $$;

-- limpiar para la sección RLS.
delete from public.team_evaluations;

-- ── RLS (role-switched) ──────────────────────────────────────────────────────

-- R1. principal inserta → OK; created_by forzado.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0002-0000-000000000000';
do $$
declare v_by uuid;
begin
  insert into public.team_evaluations (event_id, rating, comment, created_by)
    values ('99f90000-0ee0-0001-0000-000000000000', 8, 'gran partido colectivo', '00000000-0000-0000-0000-000000000000')
    returning created_by into v_by;
  if v_by <> '99f90000-aaaa-0002-0000-000000000000' then
    raise exception 'FAIL [R1]: created_by debería forzarse (got %)', v_by;
  end if;
exception when insufficient_privilege then
  raise exception 'FAIL [R1]: principal debería poder insertar';
end $$;
reset role;

-- R2. jugador inserta → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0004-0000-000000000000';
do $$ begin
  begin
    insert into public.team_evaluations (event_id, rating, created_by)
      values ('99f90000-0ee0-0001-0000-000000000000', 9, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R2]: jugador no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R3. staff de OTRO team → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0006-0000-000000000000';
do $$ begin
  begin
    insert into public.team_evaluations (event_id, rating, created_by)
      values ('99f90000-0ee0-0001-0000-000000000000', 5, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R3]: staff de otro team no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R4. admin de OTRO club → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-bbbb-0001-0000-000000000000';
do $$ begin
  begin
    insert into public.team_evaluations (event_id, rating, created_by)
      values ('99f90000-0ee0-0001-0000-000000000000', 5, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R4]: admin de otro club no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R5. flag OFF: jugador y familia del team ven 0 filas.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations where event_id = '99f90000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R5]: jugador no debería ver la colectiva con flag OFF (got %)', n; end if;
end $$;
reset role;

-- activar visibilidad (admin del club).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.club_settings (club_id, evaluations_player_visibility)
    values ('99f90000-0000-0000-0000-000000000001', true);
exception when insufficient_privilege then
  raise exception 'FAIL [setup R6]: admin debería poder activar la visibilidad';
end $$;
reset role;

-- R6. flag ON: jugador (self p1), familia (parent p1) y jugador2 (self p2, mismo
--     team) ven la colectiva → TEAM-scoped (no player-scoped).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations where event_id = '99f90000-0ee0-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [R6]: jugador del team debería ver la colectiva con flag ON (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations where event_id = '99f90000-0ee0-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [R6]: familia del team debería ver la colectiva con flag ON (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-aaaa-0008-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations where event_id = '99f90000-0ee0-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [R6]: otro jugador del mismo team debería ver la colectiva (team-scoped) (got %)', n; end if;
end $$;
reset role;

-- R7. jugador de OTRO club (admin-B no es cuenta de ningún jugador de team1) no la ve.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f90000-bbbb-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations where event_id = '99f90000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R7]: ajeno al equipo/club no debería ver la colectiva (got %)', n; end if;
end $$;
reset role;

rollback;
