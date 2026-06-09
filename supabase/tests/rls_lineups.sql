-- Tests F6 Lote A — CHECK constraints, triggers y RLS de lineups +
-- lineup_positions (migración 20260607000000_lineups.sql).
--
-- Convención del repo: psql con ON_ERROR_STOP=1; cada bloque que DEBE fallar
-- se envuelve en un DO con EXCEPTION capturando el SQLSTATE esperado y un
-- `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción con
-- ROLLBACK final → no deja rastro en la BD remota.
--
-- Casos:
--   Constraints (superuser, RLS bypass):
--     C1. field sin position_code → check_violation.
--     C2. bench con position_code → check_violation.
--     C3. location='out' (ya no existe, rediseño B') → check_violation.
--     C4. bench con coords → check_violation.
--     C5. unique (lineup_id, player_id) — mismo jugador dos veces → 23505.
--     C6. una sola oficial por evento (índice parcial) → 23505.
--     C7. inserción válida field (GK con coords) → OK.
--   Triggers (superuser):
--     T1. lineup sobre evento type='training' → event_not_match.
--     T2. lineup sobre evento sin team → event_without_team.
--     T3. lineup_position con jugador fuera del roster → player_not_in_team_at_event.
--   Permisos (RLS, role-switched) — user_can_manage_lineup:
--     P1. admin_club inserta lineup → OK.
--     P2. entrenador_principal (team_staff.staff_role) inserta → OK.
--     P3. ayudante con can_create_lineups concedida inserta → OK.
--     P4. ayudante SIN la capability → 42501.
--     P5. jugador → 42501.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('66ee0000-0000-0000-0000-000000000001', 'Club Lineup A', 'club-lineup-a');

insert into public.categories (id, club_id, name) values
  ('66ee0000-1111-0000-0000-000000000001', '66ee0000-0000-0000-0000-000000000001', 'Cat L-A');

insert into public.teams (id, category_id, name, format, color, season) values
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-1111-0000-0000-000000000001', 'Team L-A', 'F7', '#0EA5E9', '2025-26');

-- Jugadores: p1/p2/p4 en roster; p3 NO en roster (para T3).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66ee0000-3333-0000-0000-000000000001', '66ee0000-0000-0000-0000-000000000001', 'Uno',    'Roster', '2012-01-01'),
  ('66ee0000-3333-0000-0000-000000000002', '66ee0000-0000-0000-0000-000000000001', 'Dos',    'Roster', '2012-01-01'),
  ('66ee0000-3333-0000-0000-000000000003', '66ee0000-0000-0000-0000-000000000001', 'Tres',   'Fuera',  '2012-01-01'),
  ('66ee0000-3333-0000-0000-000000000004', '66ee0000-0000-0000-0000-000000000001', 'Cuatro', 'Roster', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-3333-0000-0000-000000000001', '2025-09-01'),
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-3333-0000-0000-000000000002', '2025-09-01'),
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-3333-0000-0000-000000000004', '2025-09-01');

-- Usuarios (profiles se crean por trigger handle_new_user de F1).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('66ee0000-aaaa-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-l@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('66ee0000-aaaa-0002-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-l@ts.test', now(), '{}'::jsonb, now(), now()),
  ('66ee0000-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aycap-l@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('66ee0000-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aynocap-l@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('66ee0000-aaaa-0005-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-l@ts.test',   now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('66ee0000-5555-0001-0000-000000000000', '66ee0000-aaaa-0001-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', 'admin_club'),
  ('66ee0000-5555-0002-0000-000000000000', '66ee0000-aaaa-0002-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('66ee0000-5555-0003-0000-000000000000', '66ee0000-aaaa-0003-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('66ee0000-5555-0004-0000-000000000000', '66ee0000-aaaa-0004-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('66ee0000-5555-0005-0000-000000000000', '66ee0000-aaaa-0005-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-5555-0002-0000-000000000000', 'entrenador_principal'),
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-5555-0003-0000-000000000000', 'entrenador_ayudante'),
  ('66ee0000-2222-0000-0000-000000000001', '66ee0000-5555-0004-0000-000000000000', 'entrenador_ayudante');

-- El ayudante "cap" recibe can_create_lineups (las filas las sembró el trigger
-- ensure_assistant_capabilities con granted=false).
update public.capabilities
   set granted = true
 where membership_id = '66ee0000-5555-0003-0000-000000000000'
   and capability_name = 'can_create_lineups';

-- Eventos: E1 partido (futuro), E2 entrenamiento, E3 partido SIN team.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('66ee0000-6666-0001-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', '66ee0000-2222-0000-0000-000000000001', 'match',    'Partido L1', '2026-09-15 10:00:00+00', '66ee0000-aaaa-0001-0000-000000000000'),
  ('66ee0000-6666-0002-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', '66ee0000-2222-0000-0000-000000000001', 'training', 'Entreno L1', '2026-09-12 18:00:00+00', '66ee0000-aaaa-0001-0000-000000000000'),
  ('66ee0000-6666-0003-0000-000000000000', '66ee0000-0000-0000-0000-000000000001', null,                                   'match',    'Partido club', '2026-09-16 10:00:00+00', '66ee0000-aaaa-0001-0000-000000000000');

-- Lineup base para los tests de constraints/triggers de posiciones.
insert into public.lineups (id, event_id, name, formation_code, created_by) values
  ('66ee0000-7777-0001-0000-000000000000', '66ee0000-6666-0001-0000-000000000000', 'Titular', '1-3-3', '66ee0000-aaaa-0001-0000-000000000000');

-- ─────────────────────────────────────────────────────────────────────────────
-- Constraints
-- ─────────────────────────────────────────────────────────────────────────────

-- C1. field sin position_code.
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location, position_code)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000001', 'field', null);
    raise exception 'FAIL [C1]: field sin position_code debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- C2. bench con position_code.
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location, position_code)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000001', 'bench', 'DF1');
    raise exception 'FAIL [C2]: bench con position_code debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- C3. location='out' ya no existe (rediseño Lote B') → check_violation.
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000001', 'out');
    raise exception 'FAIL [C3]: location=out debería rechazarse (solo field/bench)';
  exception when check_violation then null;
  end;
end $$;

-- C4. bench con coords.
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location, x_pct)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000001', 'bench', 10.0);
    raise exception 'FAIL [C4]: bench con coords debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- C5. unique (lineup_id, player_id).
insert into public.lineup_positions (lineup_id, player_id, location)
  values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000002', 'bench');
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000002', 'bench');
    raise exception 'FAIL [C5]: mismo jugador dos veces en el lineup debería rechazarse';
  exception when unique_violation then null;
  end;
end $$;

-- C6. una sola oficial por evento.
insert into public.lineups (id, event_id, name, formation_code, is_official, created_by) values
  ('66ee0000-7777-0002-0000-000000000000', '66ee0000-6666-0001-0000-000000000000', 'Oficial', '1-3-3', true, '66ee0000-aaaa-0001-0000-000000000000');
do $$
begin
  begin
    insert into public.lineups (event_id, name, formation_code, is_official, created_by)
      values ('66ee0000-6666-0001-0000-000000000000', 'Otra oficial', '1-3-3', true, '66ee0000-aaaa-0001-0000-000000000000');
    raise exception 'FAIL [C6]: segunda alineación oficial del mismo evento debería rechazarse';
  exception when unique_violation then null;
  end;
end $$;

-- C7. inserción válida field (GK con coords).
insert into public.lineup_positions (lineup_id, player_id, location, position_code, x_pct, y_pct)
  values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000001', 'field', 'GK', 50.0, 94.0);
do $$
declare cnt int;
begin
  select count(*) into cnt from public.lineup_positions
   where lineup_id = '66ee0000-7777-0001-0000-000000000000'
     and player_id = '66ee0000-3333-0000-0000-000000000001' and location = 'field';
  if cnt <> 1 then raise exception 'FAIL [C7]: el field válido no se insertó (cnt=%)', cnt; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- T1. lineup sobre evento de entrenamiento.
do $$
begin
  begin
    insert into public.lineups (event_id, name, formation_code, created_by)
      values ('66ee0000-6666-0002-0000-000000000000', 'X', '1-3-3', '66ee0000-aaaa-0001-0000-000000000000');
    raise exception 'FAIL [T1]: lineup sobre training debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- T2. lineup sobre evento sin team.
do $$
begin
  begin
    insert into public.lineups (event_id, name, formation_code, created_by)
      values ('66ee0000-6666-0003-0000-000000000000', 'X', '1-3-3', '66ee0000-aaaa-0001-0000-000000000000');
    raise exception 'FAIL [T2]: lineup sobre evento sin team debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- T3. lineup_position con jugador fuera del roster.
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
      values ('66ee0000-7777-0001-0000-000000000000', '66ee0000-3333-0000-0000-000000000003', 'bench');
    raise exception 'FAIL [T3]: jugador fuera del roster debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos (user_can_manage_lineup) — RLS con role authenticated
-- ─────────────────────────────────────────────────────────────────────────────

-- P1. admin_club inserta → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-aaaa-0001-0000-000000000000';
do $$
begin
  insert into public.lineups (event_id, name, formation_code, created_by)
    values ('66ee0000-6666-0001-0000-000000000000', 'P1 admin', '1-3-3', '66ee0000-aaaa-0001-0000-000000000000');
exception when others then
  raise exception 'FAIL [P1]: admin no pudo insertar lineup: %', sqlerrm;
end $$;
reset role;

-- P2. entrenador_principal (team_staff) → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-aaaa-0002-0000-000000000000';
do $$
begin
  insert into public.lineups (event_id, name, formation_code, created_by)
    values ('66ee0000-6666-0001-0000-000000000000', 'P2 principal', '1-3-3', '66ee0000-aaaa-0002-0000-000000000000');
exception when others then
  raise exception 'FAIL [P2]: principal (team_staff) no pudo insertar lineup: %', sqlerrm;
end $$;
reset role;

-- P3. ayudante con can_create_lineups → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-aaaa-0003-0000-000000000000';
do $$
begin
  insert into public.lineups (event_id, name, formation_code, created_by)
    values ('66ee0000-6666-0001-0000-000000000000', 'P3 ayudante cap', '1-3-3', '66ee0000-aaaa-0003-0000-000000000000');
exception when others then
  raise exception 'FAIL [P3]: ayudante con capability no pudo insertar lineup: %', sqlerrm;
end $$;
reset role;

-- P4. ayudante SIN la capability → 42501.
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-aaaa-0004-0000-000000000000';
do $$
begin
  begin
    insert into public.lineups (event_id, name, formation_code, created_by)
      values ('66ee0000-6666-0001-0000-000000000000', 'P4 ayudante nocap', '1-3-3', '66ee0000-aaaa-0004-0000-000000000000');
    raise exception 'FAIL [P4]: ayudante sin capability no debería poder insertar';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- P5. jugador → 42501.
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-aaaa-0005-0000-000000000000';
do $$
begin
  begin
    insert into public.lineups (event_id, name, formation_code, created_by)
      values ('66ee0000-6666-0001-0000-000000000000', 'P5 jugador', '1-3-3', '66ee0000-aaaa-0005-0000-000000000000');
    raise exception 'FAIL [P5]: jugador no debería poder insertar lineup';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
