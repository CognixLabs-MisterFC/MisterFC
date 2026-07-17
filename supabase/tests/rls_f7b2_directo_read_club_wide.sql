-- F7B-2 — Tests RLS: lectura del directo abierta a todo el club (aislamiento).
--
-- Cobertura:
--   D1. Miembro cualquiera del club A (jugador NO staff, NO ligado al equipo) LEE
--       match_state/periods/starters/events + alineación de un partido del club A.
--   D2. Aislamiento: miembro de A NO lee el directo de un partido del club B, y
--       viceversa (miembro de B NO lee el de A).
--   D3. Escritura intacta: un NO-staff NO puede insertar match_events.
--   D4. Sin relación con el club → no lee nada.
--   D5. El staff sigue leyendo (sin regresión).
\ir helpers/auth_users.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup — clubs A y B, equipos, usuarios, evento con directo sembrado en A.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('a7770000-0000-4000-8000-0000000000a1', 'Club A7', 'club-a7-f7b2'),
  ('a7770000-0000-4000-8000-0000000000b2', 'Club B7', 'club-b7-f7b2');

insert into public.categories (id, club_id, name) values
  ('c1170000-0000-4000-8000-0000000000a1', 'a7770000-0000-4000-8000-0000000000a1', 'Cat A7'),
  ('c1170000-0000-4000-8000-0000000000b2', 'a7770000-0000-4000-8000-0000000000b2', 'Cat B7');

insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('77770000-0000-4000-8000-0000000000aa', 'c1170000-0000-4000-8000-0000000000a1', 'Team A7', 'F7', '#10B981', '2025-26', 'a7770000-0000-4000-8000-0000000000a1'),
  ('77770000-0000-4000-8000-0000000000bb', 'c1170000-0000-4000-8000-0000000000b2', 'Team B7', 'F7', '#10B981', '2025-26', 'a7770000-0000-4000-8000-0000000000b2');

-- ST staff (graba) de A; FA jugador de A (NO staff, NO ligado al equipo); MB
-- miembro de B; OUT sin membership.
select pg_temp.new_test_user('51770000-0000-4000-8000-000000000011', 'st-a7@f7b2.test', '{}'::jsonb);
select pg_temp.new_test_user('51770000-0000-4000-8000-000000000022', 'fa-a7@f7b2.test', '{}'::jsonb);
select pg_temp.new_test_user('51770000-0000-4000-8000-000000000033', 'mb-b7@f7b2.test', '{}'::jsonb);
select pg_temp.new_test_user('51770000-0000-4000-8000-000000000044', 'out@f7b2.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('61770000-0000-4000-8000-000000000011', '51770000-0000-4000-8000-000000000011', 'a7770000-0000-4000-8000-0000000000a1', 'entrenador_principal'),
  ('61770000-0000-4000-8000-000000000022', '51770000-0000-4000-8000-000000000022', 'a7770000-0000-4000-8000-0000000000a1', 'jugador'),
  ('61770000-0000-4000-8000-000000000033', '51770000-0000-4000-8000-000000000033', 'a7770000-0000-4000-8000-0000000000b2', 'entrenador_principal');
-- (OUT no tiene membership a propósito.)

-- ST entrena el equipo A (autoridad de grabación).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('77770000-0000-4000-8000-0000000000aa', '61770000-0000-4000-8000-000000000011', 'entrenador_principal');

-- Jugador del equipo A (para alineación / titulares).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('e7770000-0000-4000-8000-0000000000a1', 'a7770000-0000-4000-8000-0000000000a1', 'Adri', 'Test', '2013-04-01');
insert into public.team_members (player_id, team_id, joined_at) values
  ('e7770000-0000-4000-8000-0000000000a1', '77770000-0000-4000-8000-0000000000aa', '2025-08-01');

-- Eventos: EA (partido del club A) y EB (partido del club B).
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('47770000-0000-4000-8000-0000000000aa', 'a7770000-0000-4000-8000-0000000000a1', '77770000-0000-4000-8000-0000000000aa', 'match', 'Partido A7', '2025-09-20T10:00:00Z', '51770000-0000-4000-8000-000000000011'),
  ('47770000-0000-4000-8000-0000000000bb', 'a7770000-0000-4000-8000-0000000000b2', '77770000-0000-4000-8000-0000000000bb', 'match', 'Partido B7', '2025-09-20T10:00:00Z', '51770000-0000-4000-8000-000000000033');

-- Convocatoria PUBLICADA de A: requisito para marcar oficial (mig 20261024). El
-- trigger fuerza published_by=auth.uid(); fijamos el claim solo para el seed.
set local "request.jwt.claim.sub" to '51770000-0000-4000-8000-000000000011';
insert into public.match_callup_meta (event_id, meeting_at, meeting_location, published_at)
  values ('47770000-0000-4000-8000-0000000000aa', '2025-09-20T08:00:00Z', 'Sede', now());
reset "request.jwt.claim.sub";

-- Directo sembrado en A (como postgres: bypass RLS; los triggers derivan club_id
-- y validan el evento/jugador, sin requerir auth). match_state también en B.
insert into public.match_state (event_id, club_id, status) values
  ('47770000-0000-4000-8000-0000000000aa', 'a7770000-0000-4000-8000-0000000000a1', 'live'),
  ('47770000-0000-4000-8000-0000000000bb', 'a7770000-0000-4000-8000-0000000000b2', 'live');
insert into public.match_periods (event_id, period, ordinal, running, last_started_at) values
  ('47770000-0000-4000-8000-0000000000aa', 'first_half', 1, true, now());
insert into public.match_starters (event_id, player_id, position_code) values
  ('47770000-0000-4000-8000-0000000000aa', 'e7770000-0000-4000-8000-0000000000a1', 'POR');

-- Alineación oficial (visibility='team') + una posición en el campo.
insert into public.lineups (id, event_id, name, formation_code, is_official, visibility, created_by) values
  ('17770000-0000-4000-8000-0000000000aa', '47770000-0000-4000-8000-0000000000aa', 'Titular', '1-3-3', true, 'team', '51770000-0000-4000-8000-000000000011');
insert into public.lineup_positions (lineup_id, player_id, location, position_code, x_pct, y_pct) values
  ('17770000-0000-4000-8000-0000000000aa', 'e7770000-0000-4000-8000-0000000000a1', 'field', 'POR', 50, 10);

-- match_events requiere auth.uid()=grabador (force_sender/created_by) → sembrar
-- como ST autenticado.
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000011","role":"authenticated"}';
  insert into public.match_events (id, event_id, side, type, player_id, clock_seconds) values
    (gen_random_uuid(), '47770000-0000-4000-8000-0000000000aa', 'own', 'goal', 'e7770000-0000-4000-8000-0000000000a1', 120);
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D1: FA (jugador de A, NO staff, NO ligado al equipo) LEE todo el directo de A.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare c_state int; c_periods int; c_starters int; c_events int; c_lineups int; c_pos int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000022","role":"authenticated"}';
  select count(*) into c_state    from public.match_state    where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_periods  from public.match_periods  where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_starters from public.match_starters where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_events   from public.match_events   where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_lineups  from public.lineups        where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_pos      from public.lineup_positions where lineup_id = '17770000-0000-4000-8000-0000000000aa';
  reset role;
  if c_state    < 1 then raise exception 'FAIL [D1 match_state]: FA no ve el estado (%).', c_state; end if;
  if c_periods  < 1 then raise exception 'FAIL [D1 match_periods]: FA no ve el reloj (%).', c_periods; end if;
  if c_starters < 1 then raise exception 'FAIL [D1 match_starters]: FA no ve los titulares (%).', c_starters; end if;
  if c_events   < 1 then raise exception 'FAIL [D1 match_events]: FA no ve los eventos (%).', c_events; end if;
  if c_lineups  < 1 then raise exception 'FAIL [D1 lineups]: FA no ve la alineación (%).', c_lineups; end if;
  if c_pos      < 1 then raise exception 'FAIL [D1 lineup_positions]: FA no ve las posiciones (%).', c_pos; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2: Aislamiento entre clubs (ambos sentidos).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare c_a int; c_b int; c_lineups_a int;
begin
  -- MB (club B) NO ve el directo/alineación del partido de A.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000033","role":"authenticated"}';
  select count(*) into c_a        from public.match_state where event_id = '47770000-0000-4000-8000-0000000000aa';
  select count(*) into c_lineups_a from public.lineups    where event_id = '47770000-0000-4000-8000-0000000000aa';
  reset role;
  if c_a <> 0 then raise exception 'FAIL [D2a]: MB (club B) ve el estado del partido de A (%).', c_a; end if;
  if c_lineups_a <> 0 then raise exception 'FAIL [D2a lineups]: MB ve la alineación de A (%).', c_lineups_a; end if;

  -- FA (club A) NO ve el partido de B.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000022","role":"authenticated"}';
  select count(*) into c_b from public.match_state where event_id = '47770000-0000-4000-8000-0000000000bb';
  reset role;
  if c_b <> 0 then raise exception 'FAIL [D2b]: FA (club A) ve el estado del partido de B (%).', c_b; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D3: Escritura intacta — FA (no staff) NO puede insertar match_events.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000022","role":"authenticated"}';
  begin
    insert into public.match_events (id, event_id, side, type, player_id, clock_seconds) values
      (gen_random_uuid(), '47770000-0000-4000-8000-0000000000aa', 'own', 'goal', 'e7770000-0000-4000-8000-0000000000a1', 200);
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL [D3]: un NO-staff pudo insertar un match_event (escritura no protegida)'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D4: Sin relación con el club → no lee nada.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000044","role":"authenticated"}';
  select count(*) into c from public.match_state where event_id = '47770000-0000-4000-8000-0000000000aa';
  reset role;
  if c <> 0 then raise exception 'FAIL [D4]: un usuario sin membership ve el directo (%).', c; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D5: El staff sigue leyendo (sin regresión).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"51770000-0000-4000-8000-000000000011","role":"authenticated"}';
  select count(*) into c from public.match_events where event_id = '47770000-0000-4000-8000-0000000000aa';
  reset role;
  if c < 1 then raise exception 'FAIL [D5]: el staff dejó de ver los eventos (%).', c; end if;
end $$;

rollback;

select 'OK rls_f7b2_directo_read_club_wide' as result;
