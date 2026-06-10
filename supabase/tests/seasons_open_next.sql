-- Rework C · C6 — verifica open_next_season + estado 'upcoming'.
-- Migración 20260707000000_rework_c6_open_next_season.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. Casos
-- que DEBEN fallar capturan el SQLSTATE. Constraints en superuser; la función con
-- set local role authenticated + request.jwt.claims.
--
-- Casos:
--   C1. status acepta 'upcoming'; una sola upcoming por club; active+upcoming coexisten.
--   C2. status inválido → check_violation.
--   F1. open_next_season (admin) → crea upcoming 2026-27 y clona los 2 equipos;
--       los equipos de la activa quedan intactos; los nuevos atados a la upcoming.
--   F2. re-open → idempotente (no duplica equipos; misma upcoming).
--   F3. no-admin (jugador) → forbidden.

begin;

insert into public.clubs (id, name, slug) values
  ('c6000000-0000-4000-8000-000000000001', 'Club C6', 'club-c6'),
  ('c6000000-0000-4000-8000-000000000002', 'Club C6 B', 'club-c6-b');

-- ── C1/C2. Constraints (superuser) ───────────────────────────────────────────
insert into public.seasons (club_id, label, status) values
  ('c6000000-0000-4000-8000-000000000002', '2025-26', 'active'),
  ('c6000000-0000-4000-8000-000000000002', '2026-27', 'upcoming'); -- coexisten → OK

do $$ begin
  begin
    insert into public.seasons (club_id, label, status)
      values ('c6000000-0000-4000-8000-000000000002', '2027-28', 'upcoming');
    raise exception 'FAIL [C1]: 2ª upcoming en el mismo club debería fallar';
  exception when unique_violation then null; end;
end $$;

do $$ begin
  begin
    insert into public.seasons (club_id, label, status)
      values ('c6000000-0000-4000-8000-000000000002', '2028-29', 'bogus');
    raise exception 'FAIL [C2]: status inválido debería fallar';
  exception when check_violation then null; end;
end $$;

-- ── Setup para la función: club C6 con admin, jugador, categoría, activa + 2 equipos
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('c6a00000-aaaa-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c6admin@test.local', now(), '{}'::jsonb, now(), now()),
  ('c6a00000-bbbb-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c6jug@test.local', now(), '{}'::jsonb, now(), now());

insert into public.memberships (profile_id, club_id, role) values
  ('c6a00000-aaaa-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'admin_club'),
  ('c6a00000-bbbb-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'jugador');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c6000000-0dd0-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

insert into public.seasons (club_id, label, status) values
  ('c6000000-0000-4000-8000-000000000001', '2025-26', 'active');

insert into public.teams (id, category_id, season, name, format, color) values
  ('c6000000-0eee-4000-8000-000000000001', 'c6000000-0dd0-4000-8000-000000000001', '2025-26', 'Infantil A', 'F11', '#10B981'),
  ('c6000000-0eee-4000-8000-000000000002', 'c6000000-0dd0-4000-8000-000000000001', '2025-26', 'Infantil B', 'F11', '#3B82F6');

-- ── F1. open como admin ──────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c6a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_ret text; v_up int; v_old int; v_active_seasons int;
begin
  v_ret := public.open_next_season('c6000000-0000-4000-8000-000000000001');
  if v_ret <> '2026-27' then raise exception 'FAIL [F1]: label upcoming debería ser 2026-27, es %', v_ret; end if;

  -- upcoming existe
  if not exists (select 1 from public.seasons
                  where club_id='c6000000-0000-4000-8000-000000000001' and label='2026-27' and status='upcoming') then
    raise exception 'FAIL [F1]: debería existir season upcoming 2026-27';
  end if;

  -- 2 equipos clonados a la upcoming
  select count(*) into v_up from public.teams
   where club_id='c6000000-0000-4000-8000-000000000001' and season='2026-27';
  if v_up <> 2 then raise exception 'FAIL [F1]: deberían clonarse 2 equipos a 2026-27, hay %', v_up; end if;

  -- equipos de la activa intactos
  select count(*) into v_old from public.teams
   where club_id='c6000000-0000-4000-8000-000000000001' and season='2025-26';
  if v_old <> 2 then raise exception 'FAIL [F1]: los equipos de 2025-26 deberían seguir (2), hay %', v_old; end if;

  -- la activa sigue siendo 2025-26 (no se tocó)
  select count(*) into v_active_seasons from public.seasons
   where club_id='c6000000-0000-4000-8000-000000000001' and status='active';
  if v_active_seasons <> 1 then raise exception 'FAIL [F1]: debería seguir habiendo 1 active'; end if;
end $$;

-- ── F2. re-open idempotente ──────────────────────────────────────────────────
do $$
declare v_ret text; v_up int;
begin
  v_ret := public.open_next_season('c6000000-0000-4000-8000-000000000001');
  if v_ret <> '2026-27' then raise exception 'FAIL [F2]: re-open debería reanudar 2026-27, dio %', v_ret; end if;
  select count(*) into v_up from public.teams
   where club_id='c6000000-0000-4000-8000-000000000001' and season='2026-27';
  if v_up <> 2 then raise exception 'FAIL [F2]: re-open no debe duplicar; esperaba 2, hay %', v_up; end if;
end $$;

-- ── F3. no-admin → forbidden ─────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"c6a00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.open_next_season('c6000000-0000-4000-8000-000000000001');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F3]: un no-admin NO debería poder abrir temporada'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C6: open_next_season (upcoming + clona, idempotente, admin-only, viejos intactos).'
\echo '──────────────────────────────────────────────'
