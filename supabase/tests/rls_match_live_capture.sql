-- Tests F7.1 — triggers de coherencia y RLS de la captura en vivo
-- (migración 20260611000000_match_live_capture.sql).
--
-- Convención del repo (ver rls_coach_formations.sql): psql con ON_ERROR_STOP=1; cada
-- bloque que DEBE fallar se envuelve en un DO con EXCEPTION capturando el SQLSTATE
-- esperado y un `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción
-- con ROLLBACK final → no deja rastro en la BD remota.
--
-- Casos:
--   Triggers / constraints (superuser, RLS bypass):
--     T1.  own + rival_dorsal           → check_violation (actor_by_side).
--     T2.  rival + player_id            → check_violation (actor_by_side).
--     T3.  goal con x/y                 → check_violation (coords_field_only).
--     T4.  corner con x/y               → OK.
--     T5.  goal con related_player_id   → check_violation (related_only_sub).
--     T6.  substitution sale+entra      → OK.
--     T7.  clock_seconds negativo       → check_violation.
--     T8.  own + player ajeno al team   → check_violation (player_not_in_team_at_event).
--     T9.  evento sobre TRAINING        → check_violation (event_not_match_or_friendly).
--     T10. club_id se DERIVA del evento (ignora el club_id pasado).
--     T11. event_id inmutable en UPDATE → check_violation.
--   lineups_validate relajado (§5.2):
--     L1.  alineación sobre FRIENDLY    → OK (antes rechazaba no-match).
--     L2.  alineación sobre TRAINING    → check_violation.
--   RLS match_events (role-switched):
--     R1.  principal del team inserta   → OK; created_by forzado a auth.uid().
--     R2.  ayudante (team_staff)        → OK.
--     R3.  admin del club               → OK.
--     R4.  coordinador del club         → OK.
--     R5.  jugador                      → forbidden (42501).
--     R6.  staff de OTRO team           → forbidden (42501).
--     R7.  admin de OTRO club           → forbidden (42501).
--     R8.  SELECT: principal ve evento sembrado; jugador y staff-otro-team ven 0.
--   RLS resto de tablas (smoke):
--     R9.  principal inserta match_state / match_periods / match_starters → OK.
--     R10. jugador inserta match_starters → forbidden.
--     R11. match_starters con player ajeno (superuser) → check_violation.

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('77f70000-0000-0000-0000-000000000001', 'Club F7 A', 'club-f7-a'),
  ('77f70000-0000-0000-0000-000000000002', 'Club F7 B', 'club-f7-b');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('77f70000-aaaa-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f7-a@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('77f70000-aaaa-0002-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-f7-a@ts.test', now(), '{}'::jsonb, now(), now()),
  ('77f70000-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayudante-f7-a@ts.test',  now(), '{}'::jsonb, now(), now()),
  ('77f70000-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-f7-a@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('77f70000-aaaa-0005-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-f7-a@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('77f70000-aaaa-0006-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff-team2-f7@ts.test', now(), '{}'::jsonb, now(), now()),
  ('77f70000-bbbb-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f7-b@ts.test',     now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('77f70000-5550-0001-0000-000000000000', '77f70000-aaaa-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'admin_club'),
  ('77f70000-5550-0002-0000-000000000000', '77f70000-aaaa-0002-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('77f70000-5550-0003-0000-000000000000', '77f70000-aaaa-0003-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('77f70000-5550-0004-0000-000000000000', '77f70000-aaaa-0004-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'coordinador'),
  ('77f70000-5550-0005-0000-000000000000', '77f70000-aaaa-0005-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'jugador'),
  ('77f70000-5550-0006-0000-000000000000', '77f70000-aaaa-0006-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('77f70000-5550-0007-0000-000000000000', '77f70000-bbbb-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000002', 'admin_club');

insert into public.categories (id, club_id, name, season) values
  ('77f70000-0dd0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'Cat F7 A', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('77f70000-0ee1-0001-0000-000000000000', '77f70000-0dd0-0001-0000-000000000000', 'Team 1', 'F7', '#0EA5E9'),
  ('77f70000-0ee1-0002-0000-000000000000', '77f70000-0dd0-0001-0000-000000000000', 'Team 2', 'F7', '#F59E0B');

-- principal y ayudante → team1; staff-team2 → team2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('77f70000-0ee1-0001-0000-000000000000', '77f70000-5550-0002-0000-000000000000', 'entrenador_principal'),
  ('77f70000-0ee1-0001-0000-000000000000', '77f70000-5550-0003-0000-000000000000', 'entrenador_ayudante'),
  ('77f70000-0ee1-0002-0000-000000000000', '77f70000-5550-0006-0000-000000000000', 'entrenador_principal');

-- players: p1, p2 en team1; pX solo en team2 (ajeno al roster de team1).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('77f70000-0c00-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'Pau',   'Uno',  '2010-01-01'),
  ('77f70000-0c00-0002-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'Dani',  'Dos',  '2010-02-02'),
  ('77f70000-0c00-0003-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'Iker',  'Tres', '2010-03-03');

insert into public.team_members (player_id, team_id, joined_at) values
  ('77f70000-0c00-0001-0000-000000000000', '77f70000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('77f70000-0c00-0002-0000-000000000000', '77f70000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('77f70000-0c00-0003-0000-000000000000', '77f70000-0ee1-0002-0000-000000000000', '2025-08-01');

-- events: match + friendly (team1) + training (negativo).
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', '77f70000-0ee1-0001-0000-000000000000', 'match',    'Partido liga',  '2026-03-01 10:00:00+00', '77f70000-aaaa-0002-0000-000000000000'),
  ('77f70000-0ee0-0002-0000-000000000000', '77f70000-0000-0000-0000-000000000001', '77f70000-0ee1-0001-0000-000000000000', 'friendly', 'Amistoso',      '2026-03-08 10:00:00+00', '77f70000-aaaa-0002-0000-000000000000'),
  ('77f70000-0ee0-0003-0000-000000000000', '77f70000-0000-0000-0000-000000000001', '77f70000-0ee1-0001-0000-000000000000', 'training', 'Entreno',       '2026-03-05 18:00:00+00', '77f70000-aaaa-0002-0000-000000000000');

-- Evento de match sembrado para los SELECT de RLS.
insert into public.match_events (id, event_id, club_id, side, type, player_id, clock_seconds, period, display_minute, created_by) values
  ('77f70000-0ec0-0001-0000-000000000000', '77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001',
   'own', 'goal', '77f70000-0c00-0001-0000-000000000000', 600, 'first_half', 10, '77f70000-aaaa-0002-0000-000000000000');

-- ── Triggers / constraints (superuser, RLS bypass) ───────────────────────────

-- T1. own + rival_dorsal → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, rival_dorsal, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', 9, 100, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T1]: own con rival_dorsal debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T2. rival + player_id → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'rival', 'goal', '77f70000-0c00-0001-0000-000000000000', 100, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T2]: rival con player_id debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T3. goal con x/y → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, x_pct, y_pct, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', '77f70000-0c00-0001-0000-000000000000', 100, 50, 50, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T3]: goal con coordenadas debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T4. corner con x/y → OK.
do $$ begin
  insert into public.match_events (event_id, club_id, side, type, clock_seconds, x_pct, y_pct, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'corner', 200, 12.5, 3.0, '77f70000-aaaa-0002-0000-000000000000');
exception when others then
  raise exception 'FAIL [T4]: corner con coordenadas debería permitirse: %', sqlerrm;
end $$;

-- T5. goal con related_player_id → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, related_player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', '77f70000-0c00-0001-0000-000000000000', '77f70000-0c00-0002-0000-000000000000', 100, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T5]: goal con related_player_id debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T6. substitution sale+entra → OK.
do $$ begin
  insert into public.match_events (event_id, club_id, side, type, player_id, related_player_id, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'substitution', '77f70000-0c00-0001-0000-000000000000', '77f70000-0c00-0002-0000-000000000000', 2700, '77f70000-aaaa-0002-0000-000000000000');
exception when others then
  raise exception 'FAIL [T6]: sustitución sale+entra debería permitirse: %', sqlerrm;
end $$;

-- T7. clock_seconds negativo → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', '77f70000-0c00-0001-0000-000000000000', -5, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T7]: clock_seconds negativo debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T8. own + player ajeno al team (pX está en team2) → check_violation.
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', '77f70000-0c00-0003-0000-000000000000', 100, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T8]: player ajeno al team debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T9. evento sobre TRAINING → check_violation (event_not_match_or_friendly).
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0003-0000-000000000000', '77f70000-0000-0000-0000-000000000001', 'own', 'goal', '77f70000-0c00-0001-0000-000000000000', 100, '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [T9]: evento sobre training debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- T10. club_id se DERIVA del evento (pasamos el club B, debe quedar club A).
do $$
declare v_club uuid;
begin
  insert into public.match_events (event_id, club_id, side, type, player_id, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000002', 'own', 'shot', '77f70000-0c00-0001-0000-000000000000', 300, '77f70000-aaaa-0002-0000-000000000000')
    returning club_id into v_club;
  if v_club <> '77f70000-0000-0000-0000-000000000001' then
    raise exception 'FAIL [T10]: club_id debería derivarse del evento (got %)', v_club;
  end if;
end $$;

-- T11. event_id inmutable en UPDATE → check_violation.
do $$ begin
  begin
    update public.match_events set event_id = '77f70000-0ee0-0002-0000-000000000000'
      where id = '77f70000-0ec0-0001-0000-000000000000';
    raise exception 'FAIL [T11]: event_id no debería poder cambiar';
  exception when check_violation then null; end;
end $$;

-- ── lineups_validate relajado (§5.2) ─────────────────────────────────────────

-- L1. alineación sobre FRIENDLY → OK.
do $$ begin
  insert into public.lineups (event_id, name, formation_code, created_by)
    values ('77f70000-0ee0-0002-0000-000000000000', 'Titular amistoso', '1-3-3', '77f70000-aaaa-0002-0000-000000000000');
exception when others then
  raise exception 'FAIL [L1]: alineación sobre amistoso debería permitirse: %', sqlerrm;
end $$;

-- L2. alineación sobre TRAINING → check_violation.
do $$ begin
  begin
    insert into public.lineups (event_id, name, formation_code, created_by)
      values ('77f70000-0ee0-0003-0000-000000000000', 'No', '1-3-3', '77f70000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [L2]: alineación sobre training debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- ── RLS match_events (role-switched) ─────────────────────────────────────────

-- R1. principal inserta → OK; created_by forzado a auth.uid().
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0002-0000-000000000000';
do $$
declare v_by uuid;
begin
  insert into public.match_events (event_id, side, type, player_id, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', 'own', 'yellow_card', '77f70000-0c00-0001-0000-000000000000', 1500, '00000000-0000-0000-0000-000000000000')
    returning created_by into v_by;
  if v_by <> '77f70000-aaaa-0002-0000-000000000000' then
    raise exception 'FAIL [R1]: created_by debería forzarse a auth.uid() (got %)', v_by;
  end if;
exception when insufficient_privilege then
  raise exception 'FAIL [R1]: principal debería poder insertar';
end $$;
reset role;

-- R2. ayudante (team_staff) → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0003-0000-000000000000';
do $$ begin
  insert into public.match_events (event_id, side, type, player_id, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', 'own', 'shot', '77f70000-0c00-0002-0000-000000000000', 1600, '00000000-0000-0000-0000-000000000000');
exception when insufficient_privilege then
  raise exception 'FAIL [R2]: ayudante (team_staff) debería poder insertar';
end $$;
reset role;

-- R3. admin del club → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.match_events (event_id, side, type, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', 'rival', 'corner', 1700, '00000000-0000-0000-0000-000000000000');
exception when insufficient_privilege then
  raise exception 'FAIL [R3]: admin debería poder insertar';
end $$;
reset role;

-- R4. coordinador del club → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0004-0000-000000000000';
do $$ begin
  insert into public.match_events (event_id, side, type, rival_dorsal, clock_seconds, created_by)
    values ('77f70000-0ee0-0001-0000-000000000000', 'rival', 'yellow_card', 7, 1800, '00000000-0000-0000-0000-000000000000');
exception when insufficient_privilege then
  raise exception 'FAIL [R4]: coordinador debería poder insertar';
end $$;
reset role;

-- R5. jugador → forbidden (42501).
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0005-0000-000000000000';
do $$ begin
  begin
    insert into public.match_events (event_id, side, type, player_id, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', 'own', 'goal', '77f70000-0c00-0001-0000-000000000000', 100, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R5]: jugador no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R6. staff de OTRO team → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0006-0000-000000000000';
do $$ begin
  begin
    insert into public.match_events (event_id, side, type, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', 'own', 'corner', 100, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R6]: staff de otro team no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R7. admin de OTRO club → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-bbbb-0001-0000-000000000000';
do $$ begin
  begin
    insert into public.match_events (event_id, side, type, clock_seconds, created_by)
      values ('77f70000-0ee0-0001-0000-000000000000', 'own', 'corner', 100, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R7]: admin de otro club no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R8. SELECT: principal ve el evento sembrado; jugador y staff-otro-team ven 0.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0002-0000-000000000000';
do $$ declare n int; begin
  select count(*) into n from public.match_events where id = '77f70000-0ec0-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [R8a]: principal debería ver el evento (n=%)', n; end if;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0005-0000-000000000000';
do $$ declare n int; begin
  select count(*) into n from public.match_events where id = '77f70000-0ec0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R8b]: jugador NO debería ver el evento (n=%)', n; end if;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0006-0000-000000000000';
do $$ declare n int; begin
  select count(*) into n from public.match_events where id = '77f70000-0ec0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R8c]: staff de otro team NO debería ver el evento (n=%)', n; end if;
end $$;
reset role;

-- ── RLS resto de tablas (smoke) ──────────────────────────────────────────────

-- R9. principal inserta match_state / match_periods / match_starters → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0002-0000-000000000000';
do $$
declare v_club uuid;
begin
  insert into public.match_state (event_id, club_id, status)
    values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0000-0000-0000-000000000002', 'live')
    returning club_id into v_club;
  if v_club <> '77f70000-0000-0000-0000-000000000001' then
    raise exception 'FAIL [R9a]: match_state.club_id debería derivarse del evento (got %)', v_club;
  end if;

  insert into public.match_periods (event_id, period, ordinal, base_offset_seconds)
    values ('77f70000-0ee0-0001-0000-000000000000', 'first_half', 1, 0);

  insert into public.match_starters (event_id, player_id, position_code)
    values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0c00-0001-0000-000000000000', 'POR');
exception when insufficient_privilege then
  raise exception 'FAIL [R9]: principal debería poder insertar en state/periods/starters';
end $$;
reset role;

-- R10. jugador inserta match_starters → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '77f70000-aaaa-0005-0000-000000000000';
do $$ begin
  begin
    insert into public.match_starters (event_id, player_id)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0c00-0002-0000-000000000000');
    raise exception 'FAIL [R10]: jugador no debería poder insertar starters';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R11. match_starters con player ajeno al team (superuser) → check_violation.
do $$ begin
  begin
    insert into public.match_starters (event_id, player_id)
      values ('77f70000-0ee0-0001-0000-000000000000', '77f70000-0c00-0003-0000-000000000000');
    raise exception 'FAIL [R11]: starter ajeno al team debería rechazarse';
  exception when check_violation then null; end;
end $$;

rollback;
