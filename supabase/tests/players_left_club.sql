-- Rework C · C11a — verifica set_player_left_club + columnas de baja.
-- Migración 20260711000000_rework_c11a_player_left_club.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club con admin + jugador-rol; categoría; activa 25-26 con 1 equipo; un
-- jugador con membresía abierta (histórico a preservar).
--
-- Casos:
--   F1. baja: left_club_at = fecha + razón, SIN tocar team_members (histórico).
--   F2. reactivar: left_club_at = NULL y razón limpiada.
--   F3. idempotente: re-baja a la misma fecha → mismo estado.
--   F4. "sin equipo" deriva bien y EXCLUYE bajas (club-activo sin membresía
--       abierta; un jugador de baja NO cuenta como sin equipo).
--   G1. jugador de otro club → player_invalid.
--   G2. no-admin (jugador) → forbidden.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('cb000000-0000-4000-8000-000000000001', 'Club C11a', 'club-c11a'),
  ('cb000000-0000-4000-8000-000000000002', 'Otro Club', 'otro-club-c11a');

select pg_temp.new_test_user('cba00000-aaaa-4000-8000-000000000001', 'c11admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cba00000-bbbb-4000-8000-000000000001', 'c11jug@test.local', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('cba00000-aaaa-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club'),
  ('cba00000-bbbb-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'jugador');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('cb000000-0dd0-4000-8000-00000000000a', 'cb000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

insert into public.seasons (club_id, label, status) values
  ('cb000000-0000-4000-8000-000000000001', '2025-26', 'active');

insert into public.teams (id, club_id, category_id, season, name, format, color) values
  ('cb000000-0eee-4000-8000-0000000000a1', 'cb000000-0000-4000-8000-000000000001', 'cb000000-0dd0-4000-8000-00000000000a', '2025-26', 'Infantil A', 'F11', '#10B981');

-- Leo (con equipo) y Ana (sin equipo) en el club; Forastero en el otro club (G1).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('cb000000-0f00-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'Leo', 'Uno', '2012-03-01'),
  ('cb000000-0f00-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'Ana', 'Dos', '2012-07-09'),
  ('cb000000-0f00-4000-8000-0000000000ff', 'cb000000-0000-4000-8000-000000000002', 'Forastero', 'X', '2012-01-01');

insert into public.team_members (player_id, team_id, joined_at) values
  ('cb000000-0f00-4000-8000-000000000001', 'cb000000-0eee-4000-8000-0000000000a1', '2025-09-01');

-- ── F1. baja como admin ──────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cba00000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_tm_before int; v_tm_after int;
begin
  select count(*) into v_tm_before from public.team_members
   where player_id = 'cb000000-0f00-4000-8000-000000000001';

  perform public.set_player_left_club(
    'cb000000-0000-4000-8000-000000000001',
    'cb000000-0f00-4000-8000-000000000001',
    date '2026-06-30', 'Se muda de ciudad'
  );

  if not exists (select 1 from public.players
                  where id='cb000000-0f00-4000-8000-000000000001'
                    and left_club_at = date '2026-06-30'
                    and left_club_reason = 'Se muda de ciudad') then
    raise exception 'FAIL [F1]: la baja debería fijar left_club_at + razón';
  end if;

  -- Histórico de team_members intacto.
  select count(*) into v_tm_after from public.team_members
   where player_id = 'cb000000-0f00-4000-8000-000000000001';
  if v_tm_after <> v_tm_before then
    raise exception 'FAIL [F1]: la baja NO debe tocar team_members (antes %, ahora %)', v_tm_before, v_tm_after;
  end if;
end $$;

-- ── F2. reactivar ────────────────────────────────────────────────────────────
do $$
begin
  perform public.set_player_left_club(
    'cb000000-0000-4000-8000-000000000001',
    'cb000000-0f00-4000-8000-000000000001',
    null, null
  );
  if exists (select 1 from public.players
              where id='cb000000-0f00-4000-8000-000000000001'
                and (left_club_at is not null or left_club_reason is not null)) then
    raise exception 'FAIL [F2]: reactivar debería limpiar left_club_at y la razón';
  end if;
end $$;

-- ── F3. idempotente: re-baja a la misma fecha ───────────────────────────────
do $$
declare v_cnt int;
begin
  perform public.set_player_left_club('cb000000-0000-4000-8000-000000000001','cb000000-0f00-4000-8000-000000000001', date '2026-06-30', 'x');
  perform public.set_player_left_club('cb000000-0000-4000-8000-000000000001','cb000000-0f00-4000-8000-000000000001', date '2026-06-30', 'x');
  select count(*) into v_cnt from public.players
   where id='cb000000-0f00-4000-8000-000000000001' and left_club_at = date '2026-06-30';
  if v_cnt <> 1 then raise exception 'FAIL [F3]: re-baja debería ser idempotente'; end if;
end $$;

-- ── F4. "sin equipo" deriva y excluye bajas ──────────────────────────────────
-- club-activo (left_club_at IS NULL) sin team_members abiertos.
-- Estado: Leo = baja + tiene membresía abierta; Ana = activa + sin equipo.
do $$
declare v_no_team int;
begin
  select count(*) into v_no_team
    from public.players p
   where p.club_id = 'cb000000-0000-4000-8000-000000000001'
     and p.left_club_at is null
     and not exists (
       select 1 from public.team_members tm
         join public.teams t on t.id = tm.team_id
        where tm.player_id = p.id and tm.left_at is null
          and t.club_id = 'cb000000-0000-4000-8000-000000000001'
     );
  -- Solo Ana: Leo está de baja (excluido aunque, además, tiene equipo).
  if v_no_team <> 1 then raise exception 'FAIL [F4]: sin equipo (club-activo) debería ser 1 (Ana), es %', v_no_team; end if;
  if not exists (select 1 from public.players where id='cb000000-0f00-4000-8000-000000000002' and left_club_at is null) then
    raise exception 'FAIL [F4]: Ana debería seguir activa';
  end if;
end $$;

-- ── G1. jugador de otro club → player_invalid ───────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_player_left_club(
      'cb000000-0000-4000-8000-000000000001',
      'cb000000-0f00-4000-8000-0000000000ff',  -- pertenece a otro club
      date '2026-06-30', null
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: dar de baja a un jugador de otro club debería fallar'; end if;
end $$;

-- ── G2. no-admin → forbidden ─────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"cba00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_player_left_club(
      'cb000000-0000-4000-8000-000000000001',
      'cb000000-0f00-4000-8000-000000000002',
      date '2026-06-30', null
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: un no-admin NO debería poder dar de baja'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C11a: set_player_left_club (baja/reactivar no destructivo, idempotente, sin equipo deriva y excluye bajas, admin-only).'
\echo '──────────────────────────────────────────────'
