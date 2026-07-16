-- Tests F9.5 — RLS de match_player_stats con la policy nueva player-scoped
-- (migración 20260625000000_match_player_stats_player_select.sql).
--
-- Convención del repo (ver rls_evaluations.sql): psql con ON_ERROR_STOP=1; cada
-- bloque que DEBE fallar se envuelve en un DO con EXCEPTION capturando el SQLSTATE
-- esperado; UPDATE/DELETE bajo RLS no lanzan (filtran filas) → se comprueba con
-- get diagnostics row_count. Todo en una transacción con ROLLBACK final.
--
-- 🔒 D9-1: las STATS objetivas del propio jugador son SIEMPRE visibles a él y su
-- familia, SIN depender del flag de visibilidad del club. El staff las sigue
-- viendo por la policy existente (user_can_record_match). La policy nueva NO da
-- INSERT/UPDATE/DELETE al jugador (solo SELECT).
--
-- Casos:
--   match_player_stats (policy nueva player-scoped + staff existente):
--     S1.  flag OFF: jugador (self de p1) lee SUS stats           → 1 fila (D9-1, sin flag).
--     S2.  flag OFF: familia (parent de p1) lee las de p1         → 1 fila.
--     S3.  jugador (de p1) lee las de p2 (compañero)              → 0 (player-scoped).
--     S4.  familia (de p1) lee las de p2                          → 0.
--     S5.  staff (principal del team) lee las del partido         → 2 filas (policy staff).
--     S6.  staff de OTRO equipo (mismo club) lee las del partido  → 0 (no recorder).
--     S7.  admin de OTRO club lee las de p1                       → 0.
--     S8.  jugador INSERTA stats                                  → forbidden (42501).
--     S9.  jugador ACTUALIZA sus stats                            → RLS filtra (0 filas).
--     S10. jugador BORRA sus stats                                → RLS filtra (0 filas).
--     S14. flag ON: jugador SIGUE viendo sus stats                → 1 fila (D9-1: flag-independiente).
--   Cross-check de la matriz de F8 con estos fixtures (lo subjetivo SÍ depende del flag):
--     S11. flag OFF: jugador lee evaluations(p1)                  → 0 (RLS F8).
--     S12. flag OFF: jugador lee team_evaluations(evento)         → 0 (RLS F8).
--     S13. flag OFF: jugador y familia leen private notes(p1)     → 0 (NUNCA).
--     S15. flag ON: jugador y familia leen private notes(p1)      → 0 (NUNCA, ni con flag).
\ir helpers/auth_users.sql

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('99f95000-0000-0000-0000-000000000001', 'Club F95 A', 'club-f95-a'),
  ('99f95000-0000-0000-0000-000000000002', 'Club F95 B', 'club-f95-b');

select pg_temp.new_test_user('99f95000-aaaa-0001-0000-000000000000', 'admin-f95-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('99f95000-aaaa-0002-0000-000000000000', 'principal-f95-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('99f95000-aaaa-0003-0000-000000000000', 'jugador-f95-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('99f95000-aaaa-0004-0000-000000000000', 'familia-f95-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('99f95000-aaaa-0005-0000-000000000000', 'staff-team2-f95@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('99f95000-bbbb-0001-0000-000000000000', 'admin-f95-b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('99f95000-5550-0001-0000-000000000000', '99f95000-aaaa-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'admin_club'),
  ('99f95000-5550-0002-0000-000000000000', '99f95000-aaaa-0002-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99f95000-5550-0003-0000-000000000000', '99f95000-aaaa-0003-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'jugador'),
  ('99f95000-5550-0004-0000-000000000000', '99f95000-aaaa-0004-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'jugador'),
  ('99f95000-5550-0005-0000-000000000000', '99f95000-aaaa-0005-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99f95000-5550-0006-0000-000000000000', '99f95000-bbbb-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000002', 'admin_club');

insert into public.categories (id, club_id, name) values
  ('99f95000-0dd0-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'Cat F95 A');

insert into public.teams (id, category_id, name, format, color, season) values
  ('99f95000-0ee1-0001-0000-000000000000', '99f95000-0dd0-0001-0000-000000000000', 'Team 1', 'F7', '#0EA5E9', '2025-26'),
  ('99f95000-0ee1-0002-0000-000000000000', '99f95000-0dd0-0001-0000-000000000000', 'Team 2', 'F7', '#F59E0B', '2025-26');

-- principal → team1; staff-team2 → team2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('99f95000-0ee1-0001-0000-000000000000', '99f95000-5550-0002-0000-000000000000', 'entrenador_principal'),
  ('99f95000-0ee1-0002-0000-000000000000', '99f95000-5550-0005-0000-000000000000', 'entrenador_principal');

-- players: p1, p2 en team1; p3 solo en team2.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('99f95000-0c00-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'Pau',  'Uno', '2010-01-01'),
  ('99f95000-0c00-0002-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'Dani', 'Dos', '2010-02-02'),
  ('99f95000-0c00-0003-0000-000000000000', '99f95000-0000-0000-0000-000000000001', 'Iker', 'Tres','2010-03-03');

insert into public.team_members (player_id, team_id, joined_at) values
  ('99f95000-0c00-0001-0000-000000000000', '99f95000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('99f95000-0c00-0002-0000-000000000000', '99f95000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('99f95000-0c00-0003-0000-000000000000', '99f95000-0ee1-0002-0000-000000000000', '2025-08-01');

-- cuentas: jugador-f95-a = self de p1; familia-f95-a = parent de p1.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('99f95000-0c00-0001-0000-000000000000', '99f95000-aaaa-0003-0000-000000000000', 'self'),
  ('99f95000-0c00-0001-0000-000000000000', '99f95000-aaaa-0004-0000-000000000000', 'parent');

-- evento: partido del team1.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', '99f95000-0ee1-0001-0000-000000000000', 'match', 'Partido liga', '2026-03-01 10:00:00+00', '99f95000-aaaa-0002-0000-000000000000');

-- stats consolidadas del partido para p1 y p2 (club_id/team_id se derivan en el
-- trigger; los pasamos correctos igualmente).
insert into public.match_player_stats (event_id, player_id, club_id, team_id, started, minutes_played, goals, assists) values
  ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0c00-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', '99f95000-0ee1-0001-0000-000000000000', true,  60, 2, 1),
  ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0c00-0002-0000-000000000000', '99f95000-0000-0000-0000-000000000001', '99f95000-0ee1-0001-0000-000000000000', false, 30, 0, 0);

-- valoraciones (subjetivas) + nota privada para los cross-checks de la matriz F8.
insert into public.evaluations (event_id, player_id, rating, comment, created_by) values
  ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0c00-0001-0000-000000000000', 8, 'buen partido', '99f95000-aaaa-0002-0000-000000000000');
insert into public.team_evaluations (event_id, rating, comment, created_by) values
  ('99f95000-0ee0-0001-0000-000000000000', 7, 'el equipo bien', '99f95000-aaaa-0002-0000-000000000000');
insert into public.evaluation_private_notes (event_id, player_id, note, club_id, team_id, created_by) values
  ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0c00-0001-0000-000000000000', 'apunte interno', '99f95000-0000-0000-0000-000000000001', '99f95000-0ee1-0001-0000-000000000000', '99f95000-aaaa-0002-0000-000000000000');

-- ── match_player_stats (flag OFF: NO hay fila en club_settings) ───────────────

-- S1. jugador (self de p1) lee SUS stats → 1 fila (D9-1, sin flag).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S1]: jugador debería ver SUS stats con flag OFF (got %)', n; end if;
end $$;
reset role;

-- S2. familia (parent de p1) lee las de p1 → 1 fila.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S2]: familia debería ver las stats de su jugador con flag OFF (got %)', n; end if;
end $$;
reset role;

-- S3. jugador (de p1) lee las de p2 → 0 (player-scoped).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0002-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S3]: jugador no debería ver las stats de un compañero (got %)', n; end if;
end $$;
reset role;

-- S4. familia (de p1) lee las de p2 → 0.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0002-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S4]: familia no debería ver las stats de un compañero (got %)', n; end if;
end $$;
reset role;

-- S5. staff (principal del team) lee las del partido → 2 filas (policy staff existente).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where event_id = '99f95000-0ee0-0001-0000-000000000000';
  if n <> 2 then raise exception 'FAIL [S5]: staff debería ver las 2 stats del partido (got %)', n; end if;
end $$;
reset role;

-- S6. staff de OTRO equipo (mismo club) lee las del partido → 0 (no recorder).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where event_id = '99f95000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S6]: staff de otro equipo no debería ver las stats (got %)', n; end if;
end $$;
reset role;

-- S7. admin de OTRO club lee las de p1 → 0.
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-bbbb-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S7]: admin de otro club no debería ver las stats (got %)', n; end if;
end $$;
reset role;

-- S8. jugador INSERTA stats → forbidden (no hay policy de INSERT para jugador).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$ begin
  begin
    insert into public.match_player_stats (event_id, player_id, club_id, team_id, goals)
      values ('99f95000-0ee0-0001-0000-000000000000', '99f95000-0c00-0001-0000-000000000000', '99f95000-0000-0000-0000-000000000001', '99f95000-0ee1-0001-0000-000000000000', 99);
    raise exception 'FAIL [S8]: jugador no debería poder insertar stats';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- S9. jugador ACTUALIZA sus stats → la RLS filtra (0 filas; solo tiene SELECT).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  update public.match_player_stats set goals = 99
    where event_id = '99f95000-0ee0-0001-0000-000000000000' and player_id = '99f95000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [S9]: jugador no debería poder actualizar sus stats (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- S10. jugador BORRA sus stats → la RLS filtra (0 filas).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  delete from public.match_player_stats
    where event_id = '99f95000-0ee0-0001-0000-000000000000' and player_id = '99f95000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [S10]: jugador no debería poder borrar sus stats (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- ── Cross-check matriz F8 (flag OFF): lo SUBJETIVO no se ve, lo privado NUNCA ──

-- S11. flag OFF: jugador lee evaluations(p1) → 0 (RLS de F8: necesita el flag).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S11]: jugador no debería ver evaluations con flag OFF (got %)', n; end if;
end $$;
reset role;

-- S12. flag OFF: jugador lee team_evaluations(evento) → 0 (RLS de F8: necesita el flag).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.team_evaluations
    where event_id = '99f95000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S12]: jugador no debería ver team_evaluations con flag OFF (got %)', n; end if;
end $$;
reset role;

-- S13. flag OFF: jugador y familia leen private notes(p1) → 0 (NUNCA expuesta).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S13]: jugador NUNCA debería leer notas privadas (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S13]: familia NUNCA debería leer notas privadas (got %)', n; end if;
end $$;
reset role;

-- ── Activar el flag de visibilidad y re-comprobar D9-1 + NUNCA-privado ────────

set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.club_settings (club_id, evaluations_player_visibility)
    values ('99f95000-0000-0000-0000-000000000001', true);
exception when insufficient_privilege then
  raise exception 'FAIL [setup S14]: admin debería poder activar la visibilidad';
end $$;
reset role;

-- S14. flag ON: jugador SIGUE viendo sus stats → 1 fila (D9-1: flag-independiente).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.match_player_stats
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S14]: las stats no dependen del flag (D9-1); jugador debería seguir viendo 1 (got %)', n; end if;
end $$;
reset role;

-- S15. flag ON: jugador y familia leen private notes(p1) → 0 (NUNCA, ni con flag).
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S15]: jugador NUNCA debería leer notas privadas, ni con flag ON (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '99f95000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '99f95000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S15]: familia NUNCA debería leer notas privadas, ni con flag ON (got %)', n; end if;
end $$;
reset role;

rollback;
