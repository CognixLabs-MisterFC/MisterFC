-- Tests F6 Lote B — visibilidad de alineación + RLS de notas tácticas y
-- cambios programados (migración 20260608000000_lineups_lote_b.sql).
--
-- Convención: psql ON_ERROR_STOP=1; bloques que DEBEN fallar capturan el
-- SQLSTATE esperado; todo en BEGIN/ROLLBACK.
--
-- Casos:
--   V1. visibility='team' + is_official → jugador del team VE lineups + positions.
--   V2. notas tácticas NUNCA visibles al jugador (tabla solo-staff).
--   V3. cambios programados NUNCA visibles al jugador (solo-staff).
--   V4. jugador de OTRO equipo del MISMO club SÍ ve la alineación oficial+publicada
--       (is_official + visibility='team') → directo club-wide.
--   V5. OFICIAL con visibility='staff' → el jugador/club SÍ la ve (oficial=publicada);
--       V5b: el staff también.
--   V6. is_official=false (borrador) → el jugador/club NO ve; V6b: el staff SÍ.
--       (Rama club-wide = SOLO is_official: mig 20261022 la acotó pero exigiendo
--        además visibility='team'; la mig 20261023 lo corrige a is_official a secas.)
--   S1. staff ve notas + cambios; jugador NO puede INSERT planned_substitutions (42501).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('77ff0000-0000-0000-0000-000000000001', 'Club Lote B', 'club-lote-b');
insert into public.categories (id, club_id, name) values
  ('77ff0000-1111-0000-0000-000000000001', '77ff0000-0000-0000-0000-000000000001', 'Cat LB');
insert into public.teams (id, category_id, name, format, color, season) values
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-1111-0000-0000-000000000001', 'Team LB', 'F8', '#0EA5E9', '2025-26');

-- pA en el team (vinculado a jugadorA); pB fuera del team (vinculado a jugadorB).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('77ff0000-3333-0000-0000-00000000000A', '77ff0000-0000-0000-0000-000000000001', 'Ana',  'Campo', '2012-01-01'),
  ('77ff0000-3333-0000-0000-00000000000B', '77ff0000-0000-0000-0000-000000000001', 'Ben',  'Banca', '2012-01-01'),
  ('77ff0000-3333-0000-0000-00000000000C', '77ff0000-0000-0000-0000-000000000001', 'Cris', 'Fuera', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-3333-0000-0000-00000000000A', '2025-09-01'),
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-3333-0000-0000-00000000000B', '2025-09-01');

select pg_temp.new_test_user('77ff0000-aaaa-0001-0000-000000000000', 'coach-lb@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('77ff0000-aaaa-0002-0000-000000000000', 'jugA-lb@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('77ff0000-aaaa-0003-0000-000000000000', 'jugC-lb@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('77ff0000-5555-0001-0000-000000000000', '77ff0000-aaaa-0001-0000-000000000000', '77ff0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('77ff0000-5555-0002-0000-000000000000', '77ff0000-aaaa-0002-0000-000000000000', '77ff0000-0000-0000-0000-000000000001', 'jugador'),
  ('77ff0000-5555-0003-0000-000000000000', '77ff0000-aaaa-0003-0000-000000000000', '77ff0000-0000-0000-0000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-5555-0001-0000-000000000000', 'entrenador_principal');

-- jugadorA ↔ pA (del team); jugadorC ↔ pC (fuera del team).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('77ff0000-3333-0000-0000-00000000000A', '77ff0000-aaaa-0002-0000-000000000000', 'self'),
  ('77ff0000-3333-0000-0000-00000000000C', '77ff0000-aaaa-0003-0000-000000000000', 'self');

insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77ff0000-6666-0001-0000-000000000000', '77ff0000-0000-0000-0000-000000000001', '77ff0000-2222-0000-0000-000000000001', 'match', 'Partido LB', '2026-09-20 10:00:00+00', '77ff0000-aaaa-0001-0000-000000000000');

-- Convocatoria PUBLICADA: requisito para marcar oficial (mig 20261024). El
-- trigger fuerza published_by=auth.uid(); fijamos el claim solo para el seed.
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0001-0000-000000000000';
insert into public.match_callup_meta (event_id, meeting_at, meeting_location, published_at)
  values ('77ff0000-6666-0001-0000-000000000000', '2026-09-20 08:00:00+00', 'Sede', now());
reset "request.jwt.claim.sub";

insert into public.lineups (id, event_id, name, formation_code, is_official, visibility, created_by) values
  ('77ff0000-7777-0001-0000-000000000000', '77ff0000-6666-0001-0000-000000000000', 'Titular', '1-3-3-1', true, 'team', '77ff0000-aaaa-0001-0000-000000000000');

insert into public.lineup_positions (lineup_id, player_id, location, position_code, x_pct, y_pct) values
  ('77ff0000-7777-0001-0000-000000000000', '77ff0000-3333-0000-0000-00000000000A', 'field', 'GK', 50, 94);
insert into public.lineup_positions (lineup_id, player_id, location) values
  ('77ff0000-7777-0001-0000-000000000000', '77ff0000-3333-0000-0000-00000000000B', 'bench');

insert into public.lineup_tactical_notes (lineup_id, notes) values
  ('77ff0000-7777-0001-0000-000000000000', 'Presionar arriba el primer cuarto.');

insert into public.planned_substitutions (lineup_id, minute_planned, player_out_id, player_in_id, position_code_target) values
  ('77ff0000-7777-0001-0000-000000000000', 30, '77ff0000-3333-0000-0000-00000000000A', '77ff0000-3333-0000-0000-00000000000B', 'GK');

-- ── V1: jugadorA (del team) ve la alineación oficial team-visible ────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [V1]: jugador del team no ve la alineación oficial (n=%)', n; end if;
  select count(*) into n from public.lineup_positions where lineup_id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 2 then raise exception 'FAIL [V1]: jugador no ve las posiciones (n=%)', n; end if;
end $$;

-- ── V2: notas tácticas NUNCA visibles al jugador ─────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.lineup_tactical_notes where lineup_id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V2]: jugador NO debería ver notas tácticas (n=%)', n; end if;
end $$;

-- ── V3: cambios programados NUNCA visibles al jugador ────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.planned_substitutions where lineup_id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V3]: jugador NO debería ver cambios programados (n=%)', n; end if;
end $$;
reset role;

-- ── V4: jugadorC (otro equipo, MISMO club) SÍ ve la alineación OFICIAL+PUBLICADA ─
-- La alineación es is_official=true + visibility='team' → visible a cualquier
-- miembro del club (directo). Rama club-wide de lineups_select
-- (user_belongs_to_event_club), F7B2 mig 20260830. Antes esperaba 0 (expectativa
-- vieja, incorrecta); Jose confirmó que la oficial y publicada SÍ es club-wide.
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [V4]: jugador de otro equipo del club debería ver la alineación oficial publicada (n=%)', n; end if;
end $$;
reset role;

-- ── V5: OFICIAL con visibility='staff' → el jugador SÍ la ve (es la oficial) ──
-- Corrección (mig 20261023): la rama club-wide exige SOLO is_official. Marcar una
-- alineación OFICIAL ya ES publicarla (es el once que juega); no depende de
-- visibility. Decisión de Jose: en la app, oficializar (setLineupOfficial) y
-- compartir (setLineupVisibility) son acciones independientes, el default de
-- visibility es 'staff', y en prod 10 de 10 oficiales están en 'staff' → exigir
-- 'team' (como hacía la mig 20261022) dejaba el directo vacío. Antes (20261022)
-- este caso esperaba 0; ahora es 1. El BORRADOR (V6) sigue oculto: esa era la fuga.
update public.lineups set visibility = 'staff' where id = '77ff0000-7777-0001-0000-000000000000';
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [V5]: la alineación OFICIAL (aunque visibility=staff) debería verse en el club (n=%)', n; end if;
end $$;
reset role;

-- ── V5b: el STAFF del equipo también la ve (rama user_can_manage) ─────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [V5b]: el staff del equipo SÍ debe ver la alineación solo-staff (n=%)', n; end if;
end $$;
reset role;

-- ── V6: visibility='team' pero is_official=false (BORRADOR) → jugadorA NO ve ──
-- La rama club-wide exige is_official (mig 20261022, mantenido en 20261023): el
-- borrador (once en pruebas) NO se expone a jugadores/familias ni al resto del club.
-- Esta era la fuga real que había que tapar.
update public.lineups set visibility = 'team', is_official = false where id = '77ff0000-7777-0001-0000-000000000000';
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V6]: alineación no oficial (borrador) NO debería verse aunque sea team (n=%)', n; end if;
end $$;
reset role;

-- ── V6b: el STAFF del equipo SÍ ve el BORRADOR (rama user_can_manage) ─────────
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [V6b]: el staff del equipo SÍ debe ver el borrador (n=%)', n; end if;
end $$;
reset role;

-- restablece oficial+team para S1
update public.lineups set is_official = true, visibility = 'team' where id = '77ff0000-7777-0001-0000-000000000000';

-- ── S1: staff ve notas + cambios; jugador no puede INSERT planned_sub ────────
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineup_tactical_notes where lineup_id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S1]: staff debería ver las notas tácticas (n=%)', n; end if;
  select count(*) into n from public.planned_substitutions where lineup_id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S1]: staff debería ver los cambios programados (n=%)', n; end if;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
begin
  begin
    insert into public.planned_substitutions (lineup_id, minute_planned, player_out_id, player_in_id)
      values ('77ff0000-7777-0001-0000-000000000000', 40, '77ff0000-3333-0000-0000-00000000000B', '77ff0000-3333-0000-0000-00000000000A');
    raise exception 'FAIL [S1]: jugador no debería poder crear cambios programados';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
