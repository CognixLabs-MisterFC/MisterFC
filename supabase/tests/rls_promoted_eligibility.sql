-- Tests D2.1 — elegibilidad del jugador SUBIDO (player_promotions) en los 5
-- sitios con check de roster. Se insertan filas como OWNER (RLS bypass) para
-- aislar el TRIGGER; cada bloque comprueba:
--   (a) miembro del roster sigue OK
--   (b) jugador SUBIDO al evento ahora OK
--   (c) ni-roster-ni-subido → player_not_in_team_at_event
--   (d) cross-club → player_cross_club
-- Sitios: training_attendance, callup_decisions, callup_responses,
--         lineup_positions y el helper match_assert_player_in_team (F7).
\ir helpers/auth_users.sql

begin;

-- ── Clubs ────────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('c1000000-0000-0000-0000-000000000001', 'Elig A', 'elig-a'),
  ('c1000000-0000-0000-0000-000000000002', 'Elig X', 'elig-x');

-- ── Categorías (kind fija edad) ──────────────────────────────────────────────
insert into public.categories (id, club_id, name, kind) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Cadete',   'cadete'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Infantil', 'infantil'),
  ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'Cadete X', 'cadete');

-- ── Equipos (club_id lo deriva el trigger; division explícita) ───────────────
insert into public.teams (id, category_id, name, format, color, season, division) values
  ('c3000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'Cadete S',  'F11', '#10B981', '2025-26', 'primera'),  -- SUPERIOR (evento)
  ('c3000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002', 'Infantil B','F11', '#10B981', '2025-26', 'segunda'),  -- base inferior
  ('c3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000003', 'Cadete X',  'F11', '#10B981', '2025-26', 'primera');

-- ── Admin (para FKs recorded_by/decided_by/responded_by/created_by/published_by
--    y para publicar la meta). El profile lo crea el trigger de auth.users. ────
select pg_temp.new_test_user('c4000000-0000-0000-0000-000000000001', 'admin@elig.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('c5000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'admin_club');

-- ── Jugadores ────────────────────────────────────────────────────────────────
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c6000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Pau', 'Subido', '2011-01-01'),  -- P (subido)
  ('c6000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Roc', 'Roster', '2010-01-01'),  -- R (roster de S)
  ('c6000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Ona', 'Ajena',  '2011-02-01'),  -- O (ni-ni)
  ('c6000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000002', 'Xex', 'CrossClub','2010-03-01'); -- XP (otro club)

insert into public.team_members (team_id, player_id, joined_at) values
  ('c3000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001', (current_date - interval '90 days')::date), -- P en base B
  ('c3000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', (current_date - interval '60 days')::date), -- R en S
  ('c3000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000003', (current_date - interval '90 days')::date); -- O en base B

-- ── Eventos del equipo SUPERIOR S ────────────────────────────────────────────
insert into public.events (id, club_id, team_id, type, title, starts_at, ends_at, created_by) values
  ('c7000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'match',    'S partido',  current_timestamp + interval '3 days', current_timestamp + interval '3 days 2 hours', 'c4000000-0000-0000-0000-000000000001'),
  ('c7000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'training', 'S entreno',  current_timestamp - interval '2 days', current_timestamp - interval '2 days' + interval '90 minutes', 'c4000000-0000-0000-0000-000000000001');

-- ── Subidas de P a ambos eventos (el trigger de D1 valida superioridad) ──────
insert into public.player_promotions (player_id, event_id, team_id, kind, club_id) values
  ('c6000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'match', 'c1000000-0000-0000-0000-000000000001'),
  ('c6000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 'train', 'c1000000-0000-0000-0000-000000000001');

-- ── Meta de convocatoria PUBLICADA para el partido (para callup_responses) ───
set local "request.jwt.claim.sub" to 'c4000000-0000-0000-0000-000000000001';
insert into public.match_callup_meta (event_id, meeting_at, meeting_location, published_at)
values ('c7000000-0000-0000-0000-000000000001', current_timestamp + interval '2 days 22 hours', 'Campo S', now());
reset "request.jwt.claim.sub";

-- ── Lineup para el partido (para lineup_positions) ───────────────────────────
insert into public.lineups (id, event_id, name, formation_code, created_by) values
  ('c8000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001', 'Once inicial', '1-4-3-3', 'c4000000-0000-0000-0000-000000000001');

-- ═════════════════════════════════════════════════════════════════════════════
-- TRAINING_ATTENDANCE (evento T, entreno pasado)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  -- (a) roster de S
  insert into public.training_attendance (event_id, player_id, code, recorded_by)
  values ('c7000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000002', 'presente', 'c4000000-0000-0000-0000-000000000001');
  -- (b) subido
  insert into public.training_attendance (event_id, player_id, code, recorded_by)
  values ('c7000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001', 'presente', 'c4000000-0000-0000-0000-000000000001');
exception when others then
  raise exception 'FAIL [ATT a/b]: roster o subido deberían insertar: %', sqlerrm;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by)
    values ('c7000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000003', 'presente', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [ATT c]: ni-roster-ni-subido debería rechazar'; end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by)
    values ('c7000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000009', 'presente', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [ATT d]: cross-club debería rechazar'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- CALLUP_DECISIONS (evento M, partido)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  insert into public.callup_decisions (event_id, player_id, decision, decided_by)
  values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', 'called_up', 'c4000000-0000-0000-0000-000000000001');
  insert into public.callup_decisions (event_id, player_id, decision, decided_by)
  values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'called_up', 'c4000000-0000-0000-0000-000000000001');
exception when others then
  raise exception 'FAIL [DEC a/b]: roster o subido deberían insertar: %', sqlerrm;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_decisions (event_id, player_id, decision, decided_by)
    values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000003', 'called_up', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [DEC c]: ni-roster-ni-subido debería rechazar'; end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_decisions (event_id, player_id, decision, decided_by)
    values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000009', 'called_up', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [DEC d]: cross-club debería rechazar'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- CALLUP_RESPONSES (evento M, partido, meta publicada)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  insert into public.callup_responses (event_id, player_id, status, responded_by)
  values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', 'yes', 'c4000000-0000-0000-0000-000000000001');
  insert into public.callup_responses (event_id, player_id, status, responded_by)
  values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'yes', 'c4000000-0000-0000-0000-000000000001');
exception when others then
  raise exception 'FAIL [RESP a/b]: roster o subido deberían insertar: %', sqlerrm;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_responses (event_id, player_id, status, responded_by)
    values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000003', 'yes', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [RESP c]: ni-roster-ni-subido debería rechazar'; end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_responses (event_id, player_id, status, responded_by)
    values ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000009', 'yes', 'c4000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [RESP d]: cross-club debería rechazar'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- LINEUP_POSITIONS (lineup L del partido M)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  insert into public.lineup_positions (lineup_id, player_id, location)
  values ('c8000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', 'bench');
  insert into public.lineup_positions (lineup_id, player_id, location)
  values ('c8000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'bench');
exception when others then
  raise exception 'FAIL [LINEUP a/b]: roster o subido deberían insertar: %', sqlerrm;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
    values ('c8000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000003', 'bench');
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [LINEUP c]: ni-roster-ni-subido debería rechazar'; end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
    values ('c8000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000009', 'bench');
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [LINEUP d]: cross-club debería rechazar'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- HELPER match_assert_player_in_team (cubre starters/events/absences/stats/eval)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = 'c7000000-0000-0000-0000-000000000001';
  -- (a) roster + (b) subido: no deben lanzar.
  perform public.match_assert_player_in_team('c6000000-0000-0000-0000-000000000002', v_ev);
  perform public.match_assert_player_in_team('c6000000-0000-0000-0000-000000000001', v_ev);
exception when others then
  raise exception 'FAIL [HELPER a/b]: roster o subido no deberían lanzar: %', sqlerrm;
end $$;

do $$
declare v_ev public.events%rowtype; ok boolean := false;
begin
  select * into v_ev from public.events where id = 'c7000000-0000-0000-0000-000000000001';
  begin
    perform public.match_assert_player_in_team('c6000000-0000-0000-0000-000000000003', v_ev);
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [HELPER c]: ni-roster-ni-subido debería lanzar'; end if;
end $$;

do $$
declare v_ev public.events%rowtype; ok boolean := false;
begin
  select * into v_ev from public.events where id = 'c7000000-0000-0000-0000-000000000001';
  begin
    perform public.match_assert_player_in_team('c6000000-0000-0000-0000-000000000009', v_ev);
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [HELPER d]: cross-club debería lanzar'; end if;
end $$;

rollback;
