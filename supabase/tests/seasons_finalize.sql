-- Rework C · C8 — verifica finalize_active_season (cierre del rollover).
-- Migración 20260709000000_rework_c8_finalize_season.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club con admin + jugador-rol; categoría; activa 25-26 con 1 equipo y 2
-- jugadores con membresía abierta; upcoming 26-27 con 1 equipo y 1 jugador ya
-- COLOCADO (membresía abierta, simula C7). El 2º jugador NO está colocado.
--
-- Casos:
--   G1. sin upcoming → no_upcoming (guard).
--   G2. no-admin → forbidden.
--   F1. finalizar: cierra las 2 membresías de la activa a la fecha de corte;
--       la membresía de la upcoming sigue ABIERTA; activa→finalized,
--       upcoming→active; devuelve '2026-27'; queda 1 active y 0 upcoming.
--   F2. idempotencia/atomicidad: 2ª llamada → no_upcoming (no hay doble cierre).
--   PC. pre-chequeo (read): jugador en la activa NO colocado en la upcoming.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('c8000000-0000-4000-8000-000000000001', 'Club C8', 'club-c8');

select pg_temp.new_test_user('c8a00000-aaaa-4000-8000-000000000001', 'c8admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('c8a00000-bbbb-4000-8000-000000000001', 'c8jug@test.local', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('c8a00000-aaaa-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'admin_club'),
  ('c8a00000-bbbb-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'jugador');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c8000000-0dd0-4000-8000-00000000000a', 'c8000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

-- ── G1. finalizar sin upcoming → no_upcoming ─────────────────────────────────
insert into public.seasons (club_id, label, status) values
  ('c8000000-0000-4000-8000-000000000001', '2025-26', 'active');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    perform public.finalize_active_season('c8000000-0000-4000-8000-000000000001', date '2026-07-31');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: finalizar sin upcoming debería rechazarse (no_upcoming)'; end if;
end $$;

-- ── Setup restante (superuser): upcoming + equipos + jugadores + membresías ──
reset role;

insert into public.seasons (club_id, label, status) values
  ('c8000000-0000-4000-8000-000000000001', '2026-27', 'upcoming');

insert into public.teams (id, category_id, season, name, format, color) values
  ('c8000000-0eee-4000-8000-0000000000a1', 'c8000000-0dd0-4000-8000-00000000000a', '2025-26', 'Infantil A', 'F11', '#10B981'),
  ('c8000000-0eee-4000-8000-0000000000a2', 'c8000000-0dd0-4000-8000-00000000000a', '2026-27', 'Infantil A', 'F11', '#10B981');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c8000000-0f00-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'Leo', 'Uno', '2012-03-01'),
  ('c8000000-0f00-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001', 'Iker', 'Dos', '2012-07-09');

-- Ambos activos en Infantil A (25-26). Solo Leo colocado en Infantil A (26-27).
insert into public.team_members (player_id, team_id, joined_at) values
  ('c8000000-0f00-4000-8000-000000000001', 'c8000000-0eee-4000-8000-0000000000a1', '2025-09-01'),
  ('c8000000-0f00-4000-8000-000000000002', 'c8000000-0eee-4000-8000-0000000000a1', '2025-09-01'),
  ('c8000000-0f00-4000-8000-000000000001', 'c8000000-0eee-4000-8000-0000000000a2', '2026-06-10');

-- ── PC. pre-chequeo: jugadores en la activa sin colocar en la upcoming ───────
do $$
declare v_unplaced int;
begin
  select count(*) into v_unplaced
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.club_id = 'c8000000-0000-4000-8000-000000000001'
     and t.season = '2025-26' and tm.left_at is null
     and not exists (
       select 1 from public.team_members u
         join public.teams ut on ut.id = u.team_id
        where u.player_id = tm.player_id and u.left_at is null
          and ut.club_id = 'c8000000-0000-4000-8000-000000000001'
          and ut.season = '2026-27'
     );
  if v_unplaced <> 1 then raise exception 'FAIL [PC]: debería haber 1 no-colocado (Iker), hay %', v_unplaced; end if;
end $$;

-- ── G2. no-admin → forbidden ─────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8a00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.finalize_active_season('c8000000-0000-4000-8000-000000000001', date '2026-07-31');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: un no-admin NO debería poder finalizar'; end if;
end $$;

-- ── F1. finalizar como admin ─────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"c8a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_ret text; v_open_active int; v_open_upcoming int; v_act int; v_up int;
begin
  v_ret := public.finalize_active_season('c8000000-0000-4000-8000-000000000001', date '2026-07-31');
  if v_ret <> '2026-27' then raise exception 'FAIL [F1]: nueva activa debería ser 2026-27, dio %', v_ret; end if;

  -- Membresías de la activa: cerradas a la fecha de corte (0 abiertas, 2 con left_at = corte).
  select count(*) into v_open_active from public.team_members
   where team_id = 'c8000000-0eee-4000-8000-0000000000a1' and left_at is null;
  if v_open_active <> 0 then raise exception 'FAIL [F1]: las membresías de la activa deberían cerrarse, abiertas = %', v_open_active; end if;
  if (select count(*) from public.team_members
       where team_id = 'c8000000-0eee-4000-8000-0000000000a1' and left_at = date '2026-07-31') <> 2 then
    raise exception 'FAIL [F1]: las 2 membresías de la activa deberían tener left_at = fecha de corte';
  end if;

  -- Membresía de la upcoming: sigue ABIERTA.
  select count(*) into v_open_upcoming from public.team_members
   where team_id = 'c8000000-0eee-4000-8000-0000000000a2' and left_at is null;
  if v_open_upcoming <> 1 then raise exception 'FAIL [F1]: la membresía de la upcoming NO debe cerrarse, abiertas = %', v_open_upcoming; end if;

  -- Estados: 1 active (26-27), 0 upcoming, 25-26 finalized.
  select count(*) into v_act from public.seasons
   where club_id = 'c8000000-0000-4000-8000-000000000001' and status = 'active';
  if v_act <> 1 then raise exception 'FAIL [F1]: debería haber 1 active, hay %', v_act; end if;
  select count(*) into v_up from public.seasons
   where club_id = 'c8000000-0000-4000-8000-000000000001' and status = 'upcoming';
  if v_up <> 0 then raise exception 'FAIL [F1]: no debería quedar upcoming, hay %', v_up; end if;
  if not exists (select 1 from public.seasons
                  where club_id='c8000000-0000-4000-8000-000000000001' and label='2025-26' and status='finalized') then
    raise exception 'FAIL [F1]: 2025-26 debería quedar finalized';
  end if;
  if not exists (select 1 from public.seasons
                  where club_id='c8000000-0000-4000-8000-000000000001' and label='2026-27' and status='active') then
    raise exception 'FAIL [F1]: 2026-27 debería quedar active';
  end if;

  -- El roster de la nueva activa (26-27) muestra al colocado (Leo, left_at null).
  if not exists (select 1 from public.team_members
                  where team_id='c8000000-0eee-4000-8000-0000000000a2'
                    and player_id='c8000000-0f00-4000-8000-000000000001' and left_at is null) then
    raise exception 'FAIL [F1]: el roster de 26-27 debería incluir a Leo';
  end if;
end $$;

-- ── F2. idempotencia/atomicidad: re-finalizar → no_upcoming ──────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.finalize_active_season('c8000000-0000-4000-8000-000000000001', date '2027-07-31');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F2]: re-finalizar (sin upcoming) debería rechazarse'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C8: finalize_active_season (cierra la activa a la fecha de corte, upcoming intacta, rollover de estados, guards, atómico).'
\echo '──────────────────────────────────────────────'
