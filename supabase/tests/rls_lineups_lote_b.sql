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
--   V4. jugador de OTRO player (no del team) NO ve la alineación.
--   V5. visibility='staff' → el jugador del team deja de ver la alineación.
--   V6. is_official=false + visibility='team' → el jugador NO ve (debe ser oficial).
--   S1. staff ve notas + cambios; jugador NO puede INSERT planned_substitutions (42501).

begin;

insert into public.clubs (id, name, slug) values
  ('77ff0000-0000-0000-0000-000000000001', 'Club Lote B', 'club-lote-b');
insert into public.categories (id, club_id, name, season) values
  ('77ff0000-1111-0000-0000-000000000001', '77ff0000-0000-0000-0000-000000000001', 'Cat LB', '2025-26');
insert into public.teams (id, category_id, name, format, color) values
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-1111-0000-0000-000000000001', 'Team LB', 'F8', '#0EA5E9');

-- pA en el team (vinculado a jugadorA); pB fuera del team (vinculado a jugadorB).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('77ff0000-3333-0000-0000-00000000000A', '77ff0000-0000-0000-0000-000000000001', 'Ana',  'Campo', '2012-01-01'),
  ('77ff0000-3333-0000-0000-00000000000B', '77ff0000-0000-0000-0000-000000000001', 'Ben',  'Banca', '2012-01-01'),
  ('77ff0000-3333-0000-0000-00000000000C', '77ff0000-0000-0000-0000-000000000001', 'Cris', 'Fuera', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-3333-0000-0000-00000000000A', '2025-09-01'),
  ('77ff0000-2222-0000-0000-000000000001', '77ff0000-3333-0000-0000-00000000000B', '2025-09-01');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('77ff0000-aaaa-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-lb@ts.test',  now(), '{}'::jsonb, now(), now()),
  ('77ff0000-aaaa-0002-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugA-lb@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('77ff0000-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugC-lb@ts.test',   now(), '{}'::jsonb, now(), now());

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

-- ── V4: jugadorC (fuera del team) NO ve la alineación ────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V4]: jugador fuera del team NO debería ver la alineación (n=%)', n; end if;
end $$;
reset role;

-- ── V5: visibility='staff' → jugadorA deja de ver ───────────────────────────
update public.lineups set visibility = 'staff' where id = '77ff0000-7777-0001-0000-000000000000';
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V5]: con visibility=staff el jugador NO debería ver (n=%)', n; end if;
end $$;
reset role;

-- ── V6: visibility='team' pero is_official=false → jugadorA NO ve ────────────
update public.lineups set visibility = 'team', is_official = false where id = '77ff0000-7777-0001-0000-000000000000';
set local role authenticated;
set local "request.jwt.claim.sub" to '77ff0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.lineups where id = '77ff0000-7777-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [V6]: alineación no oficial NO debería verse aunque sea team (n=%)', n; end if;
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
