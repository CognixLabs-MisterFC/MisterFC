-- Rework C · C7 — verifica place_players_in_upcoming.
-- Migración 20260708000000_rework_c7_place_players_upcoming.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club con admin + jugador-rol; 1 categoría Infantil + 1 Cadete; activa
-- 2025-26 con 1 equipo (Infantil A) y 2 jugadores con membresía activa; upcoming
-- 2026-27 con 2 equipos (Infantil A' y Cadete A' → cross-categoría).
--
-- Casos:
--   F1. colocar pone a los jugadores en el equipo upcoming (membresía activa)
--       SIN cerrar/tocar su membresía de la activa (left_at sigue null en 25-26).
--   F2. cross-categoría permitido (Infantil → Cadete upcoming).
--   F3. idempotente: re-run no duplica (0 colocados, sigue 1 fila activa).
--   F4. colocar en un equipo NO upcoming (de la activa) → dest_not_upcoming.
--   F5. no-admin (jugador) → forbidden.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('c7000000-0000-4000-8000-000000000001', 'Club C7', 'club-c7');

select pg_temp.new_test_user('c7a00000-aaaa-4000-8000-000000000001', 'c7admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('c7a00000-bbbb-4000-8000-000000000001', 'c7jug@test.local', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('c7a00000-aaaa-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'admin_club'),
  ('c7a00000-bbbb-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'jugador');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c7000000-0dd0-4000-8000-00000000000a', 'c7000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true),
  ('c7000000-0dd0-4000-8000-00000000000c', 'c7000000-0000-4000-8000-000000000001', 'Cadete', 'cadete', 40, true);

insert into public.seasons (club_id, label, status) values
  ('c7000000-0000-4000-8000-000000000001', '2025-26', 'active'),
  ('c7000000-0000-4000-8000-000000000001', '2026-27', 'upcoming');

-- Equipo de la activa + 2 equipos de la upcoming (uno de otra categoría).
insert into public.teams (id, category_id, season, name, format, color) values
  ('c7000000-0eee-4000-8000-0000000000a1', 'c7000000-0dd0-4000-8000-00000000000a', '2025-26', 'Infantil A', 'F11', '#10B981'),
  ('c7000000-0eee-4000-8000-0000000000a2', 'c7000000-0dd0-4000-8000-00000000000a', '2026-27', 'Infantil A', 'F11', '#10B981'),
  ('c7000000-0eee-4000-8000-0000000000c2', 'c7000000-0dd0-4000-8000-00000000000c', '2026-27', 'Cadete A',   'F11', '#3B82F6');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c7000000-0f00-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'Leo', 'Uno', '2012-03-01'),
  ('c7000000-0f00-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 'Iker', 'Dos', '2012-07-09');

-- Ambos jugadores ACTIVOS en Infantil A (2025-26).
insert into public.team_members (player_id, team_id, joined_at) values
  ('c7000000-0f00-4000-8000-000000000001', 'c7000000-0eee-4000-8000-0000000000a1', '2025-09-01'),
  ('c7000000-0f00-4000-8000-000000000002', 'c7000000-0eee-4000-8000-0000000000a1', '2025-09-01');

-- ── F1. colocar como admin en Infantil A' (upcoming) ─────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c7a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_placed int; v_active_in_old int; v_in_up int;
begin
  v_placed := public.place_players_in_upcoming(
    'c7000000-0000-4000-8000-000000000001',
    'c7000000-0eee-4000-8000-0000000000a2',
    array['c7000000-0f00-4000-8000-000000000001','c7000000-0f00-4000-8000-000000000002']::uuid[]
  );
  if v_placed <> 2 then raise exception 'FAIL [F1]: deberían colocarse 2, fueron %', v_placed; end if;

  -- Ambos activos en el equipo upcoming.
  select count(*) into v_in_up from public.team_members
   where team_id='c7000000-0eee-4000-8000-0000000000a2' and left_at is null;
  if v_in_up <> 2 then raise exception 'FAIL [F1]: 2 activos en upcoming, hay %', v_in_up; end if;

  -- Membresía de la ACTIVA intacta: siguen activos en Infantil A (2025-26), left_at null.
  select count(*) into v_active_in_old from public.team_members
   where team_id='c7000000-0eee-4000-8000-0000000000a1' and left_at is null;
  if v_active_in_old <> 2 then
    raise exception 'FAIL [F1]: la membresía de la activa NO debe cerrarse; activos en 25-26 = %', v_active_in_old;
  end if;
end $$;

-- ── F2. cross-categoría: colocar Leo en Cadete A' (upcoming, otra categoría) ──
do $$
declare v_placed int;
begin
  v_placed := public.place_players_in_upcoming(
    'c7000000-0000-4000-8000-000000000001',
    'c7000000-0eee-4000-8000-0000000000c2',
    array['c7000000-0f00-4000-8000-000000000001']::uuid[]
  );
  if v_placed <> 1 then raise exception 'FAIL [F2]: cross-categoría debería colocar 1, fue %', v_placed; end if;
  if not exists (select 1 from public.team_members
                  where player_id='c7000000-0f00-4000-8000-000000000001'
                    and team_id='c7000000-0eee-4000-8000-0000000000c2' and left_at is null) then
    raise exception 'FAIL [F2]: Leo debería quedar activo en Cadete A upcoming';
  end if;
end $$;

-- ── F3. idempotente: re-colocar en Infantil A' no duplica ────────────────────
do $$
declare v_placed int; v_in_up int;
begin
  v_placed := public.place_players_in_upcoming(
    'c7000000-0000-4000-8000-000000000001',
    'c7000000-0eee-4000-8000-0000000000a2',
    array['c7000000-0f00-4000-8000-000000000001','c7000000-0f00-4000-8000-000000000002']::uuid[]
  );
  if v_placed <> 0 then raise exception 'FAIL [F3]: re-run no debería colocar a nadie, colocó %', v_placed; end if;
  select count(*) into v_in_up from public.team_members
   where team_id='c7000000-0eee-4000-8000-0000000000a2' and left_at is null;
  if v_in_up <> 2 then raise exception 'FAIL [F3]: sin duplicados; esperaba 2 activos, hay %', v_in_up; end if;
end $$;

-- ── F4. destino NO upcoming (equipo de la activa) → dest_not_upcoming ────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.place_players_in_upcoming(
      'c7000000-0000-4000-8000-000000000001',
      'c7000000-0eee-4000-8000-0000000000a1',  -- equipo de 2025-26 (activa)
      array['c7000000-0f00-4000-8000-000000000002']::uuid[]
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F4]: colocar en equipo de la activa debería fallar (dest_not_upcoming)'; end if;
end $$;

-- ── F5. no-admin (jugador) → forbidden ───────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"c7a00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.place_players_in_upcoming(
      'c7000000-0000-4000-8000-000000000001',
      'c7000000-0eee-4000-8000-0000000000a2',
      array['c7000000-0f00-4000-8000-000000000001']::uuid[]
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F5]: un no-admin NO debería poder colocar jugadores'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C7: place_players_in_upcoming (coloca sin cerrar la activa, cross-cat, idempotente, dest upcoming, admin-only).'
\echo '──────────────────────────────────────────────'
