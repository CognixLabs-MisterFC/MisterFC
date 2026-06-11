-- Rework C · C9 — verifica unplace_player_from_upcoming.
-- Migración 20260710000000_rework_c9_unplace_player_upcoming.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club con admin + jugador-rol; categoría; activa 25-26 con 1 equipo y el
-- jugador con membresía abierta; upcoming 26-27 con 1 equipo donde el jugador
-- está COLOCADO (membresía abierta, simula C7).
--
-- Casos:
--   F1. desasignar (admin) del equipo upcoming → borra la colocación (1 fila);
--       la membresía de la temporada ACTIVA queda intacta.
--   F2. idempotente: re-desasignar → 0 filas (no-op), sin error.
--   G1. GUARD: desasignar de un equipo de la temporada ACTIVA → not_upcoming
--       (y la fila NO se borra).
--   G2. GUARD: desasignar de un equipo de una temporada FINALIZED → not_upcoming.
--   G3. no-admin (jugador) → forbidden.

begin;

insert into public.clubs (id, name, slug) values
  ('c9000000-0000-4000-8000-000000000001', 'Club C9', 'club-c9');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('c9a00000-aaaa-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c9admin@test.local', now(), '{}'::jsonb, now(), now()),
  ('c9a00000-bbbb-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c9jug@test.local', now(), '{}'::jsonb, now(), now());

insert into public.memberships (profile_id, club_id, role) values
  ('c9a00000-aaaa-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'admin_club'),
  ('c9a00000-bbbb-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'jugador');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c9000000-0dd0-4000-8000-00000000000a', 'c9000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

-- Activa 25-26, upcoming 26-27 y una FINALIZED 24-25 (para el guard G2).
insert into public.seasons (club_id, label, status) values
  ('c9000000-0000-4000-8000-000000000001', '2024-25', 'finalized'),
  ('c9000000-0000-4000-8000-000000000001', '2025-26', 'active'),
  ('c9000000-0000-4000-8000-000000000001', '2026-27', 'upcoming');

insert into public.teams (id, category_id, season, name, format, color) values
  ('c9000000-0eee-4000-8000-0000000000f1', 'c9000000-0dd0-4000-8000-00000000000a', '2024-25', 'Infantil A', 'F11', '#6B7280'),
  ('c9000000-0eee-4000-8000-0000000000a1', 'c9000000-0dd0-4000-8000-00000000000a', '2025-26', 'Infantil A', 'F11', '#10B981'),
  ('c9000000-0eee-4000-8000-0000000000a2', 'c9000000-0dd0-4000-8000-00000000000a', '2026-27', 'Infantil A', 'F11', '#10B981');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c9000000-0f00-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'Leo', 'Uno', '2012-03-01');

-- Leo: activo en Infantil A (25-26), histórico en Infantil A (24-25, cerrado),
-- y colocado en Infantil A (26-27, abierto, simula C7).
insert into public.team_members (player_id, team_id, joined_at, left_at) values
  ('c9000000-0f00-4000-8000-000000000001', 'c9000000-0eee-4000-8000-0000000000f1', '2024-09-01', '2025-06-30');
insert into public.team_members (player_id, team_id, joined_at) values
  ('c9000000-0f00-4000-8000-000000000001', 'c9000000-0eee-4000-8000-0000000000a1', '2025-09-01'),
  ('c9000000-0f00-4000-8000-000000000001', 'c9000000-0eee-4000-8000-0000000000a2', '2026-06-10');

-- ── F1. desasignar del upcoming como admin ──────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c9a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_del int; v_in_up int; v_in_active int;
begin
  v_del := public.unplace_player_from_upcoming(
    'c9000000-0000-4000-8000-000000000001',
    'c9000000-0eee-4000-8000-0000000000a2',
    'c9000000-0f00-4000-8000-000000000001'
  );
  if v_del <> 1 then raise exception 'FAIL [F1]: debería borrar 1 colocación, borró %', v_del; end if;

  select count(*) into v_in_up from public.team_members
   where team_id = 'c9000000-0eee-4000-8000-0000000000a2';
  if v_in_up <> 0 then raise exception 'FAIL [F1]: la colocación upcoming debería desaparecer, quedan %', v_in_up; end if;

  -- La membresía de la ACTIVA intacta (sigue abierta).
  select count(*) into v_in_active from public.team_members
   where team_id = 'c9000000-0eee-4000-8000-0000000000a1' and left_at is null;
  if v_in_active <> 1 then raise exception 'FAIL [F1]: la membresía de la activa NO debe tocarse, abiertas = %', v_in_active; end if;
end $$;

-- ── F2. idempotente: re-desasignar → 0 ──────────────────────────────────────
do $$
declare v_del int;
begin
  v_del := public.unplace_player_from_upcoming(
    'c9000000-0000-4000-8000-000000000001',
    'c9000000-0eee-4000-8000-0000000000a2',
    'c9000000-0f00-4000-8000-000000000001'
  );
  if v_del <> 0 then raise exception 'FAIL [F2]: re-desasignar debería ser no-op (0), borró %', v_del; end if;
end $$;

-- ── G1. GUARD: desasignar de un equipo de la ACTIVA → not_upcoming ──────────
do $$
declare ok boolean := false; v_still int;
begin
  begin
    perform public.unplace_player_from_upcoming(
      'c9000000-0000-4000-8000-000000000001',
      'c9000000-0eee-4000-8000-0000000000a1',  -- equipo de 2025-26 (activa)
      'c9000000-0f00-4000-8000-000000000001'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: desasignar de un equipo de la activa debería fallar (not_upcoming)'; end if;
  -- Y la membresía de la activa sigue ahí.
  select count(*) into v_still from public.team_members
   where team_id = 'c9000000-0eee-4000-8000-0000000000a1' and left_at is null;
  if v_still <> 1 then raise exception 'FAIL [G1]: la membresía de la activa NO debe borrarse'; end if;
end $$;

-- ── G2. GUARD: desasignar de un equipo FINALIZED → not_upcoming ──────────────
do $$
declare ok boolean := false; v_still int;
begin
  begin
    perform public.unplace_player_from_upcoming(
      'c9000000-0000-4000-8000-000000000001',
      'c9000000-0eee-4000-8000-0000000000f1',  -- equipo de 2024-25 (finalized)
      'c9000000-0f00-4000-8000-000000000001'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: desasignar de un equipo finalized debería fallar (not_upcoming)'; end if;
  select count(*) into v_still from public.team_members
   where team_id = 'c9000000-0eee-4000-8000-0000000000f1';
  if v_still <> 1 then raise exception 'FAIL [G2]: el histórico finalized NO debe borrarse'; end if;
end $$;

-- ── G3. no-admin (jugador) → forbidden ──────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"c9a00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.unplace_player_from_upcoming(
      'c9000000-0000-4000-8000-000000000001',
      'c9000000-0eee-4000-8000-0000000000a2',
      'c9000000-0f00-4000-8000-000000000001'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G3]: un no-admin NO debería poder desasignar'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C9: unplace_player_from_upcoming (borra colocación upcoming, idempotente, guard upcoming-only, activa/finalized intactas, admin-only).'
\echo '──────────────────────────────────────────────'
