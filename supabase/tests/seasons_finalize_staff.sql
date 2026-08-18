-- O2 · finalize_active_season cierra TAMBIÉN el cuerpo técnico (team_staff).
-- Migración 20261041000000_o2_finalize_close_staff_and_active_season_scope.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La función
-- con set local role authenticated + request.jwt.claims.
--
-- Casos:
--   S1. finalizar: cierra las asignaciones team_staff de los equipos de la ACTIVA a
--       la fecha de corte; la asignación en el equipo de la UPCOMING sigue ABIERTA.
--   S2. guard: si un staff de la activa tiene joined_at > cutoff, finalize falla con
--       'cutoff_too_early' (el guard ahora considera team_staff, no solo team_members).
\ir helpers/auth_users.sql

begin;

-- ═══ Club S1: cierre de team_staff al finalizar ══════════════════════════════
insert into public.clubs (id, name, slug) values
  ('cf000000-0000-4000-8000-000000000001', 'Club CF1', 'club-cf1');

select pg_temp.new_test_user('cf0a0000-aaaa-4000-8000-000000000001', 'cf1admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cf0a0000-cccc-4000-8000-000000000001', 'cf1coach@test.local', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('cf0b0000-aaaa-4000-8000-000000000001', 'cf0a0000-aaaa-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'admin_club'),
  ('cf0b0000-cccc-4000-8000-000000000001', 'cf0a0000-cccc-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('cf000000-0dd0-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

insert into public.seasons (club_id, label, status) values
  ('cf000000-0000-4000-8000-000000000001', '2025-26', 'active'),
  ('cf000000-0000-4000-8000-000000000001', '2026-27', 'upcoming');

-- Dos equipos "Infantil B" con mismo nombre y distinta temporada (como el bug real).
insert into public.teams (id, category_id, season, name, format, color) values
  ('cf000000-0eee-4000-8000-0000000000a1', 'cf000000-0dd0-4000-8000-00000000000a', '2025-26', 'Infantil B', 'F11', '#10B981'),
  ('cf000000-0eee-4000-8000-0000000000a2', 'cf000000-0dd0-4000-8000-00000000000a', '2026-27', 'Infantil B', 'F11', '#10B981');

-- El entrenador está en team_staff de AMBOS equipos, ambos abiertos (left_at null).
insert into public.team_staff (team_id, membership_id, staff_role, joined_at) values
  ('cf000000-0eee-4000-8000-0000000000a1', 'cf0b0000-cccc-4000-8000-000000000001', 'entrenador_principal', '2025-09-01'),
  ('cf000000-0eee-4000-8000-0000000000a2', 'cf0b0000-cccc-4000-8000-000000000001', 'entrenador_principal', '2026-06-10');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cf0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_ret text; v_open_active int; v_closed_active int; v_open_upcoming int;
begin
  v_ret := public.finalize_active_season('cf000000-0000-4000-8000-000000000001', date '2026-07-31');
  if v_ret <> '2026-27' then raise exception 'FAIL [S1]: nueva activa debería ser 2026-27, dio %', v_ret; end if;

  -- team_staff de la ACTIVA (equipo 25-26): cerrado a la fecha de corte.
  select count(*) into v_open_active from public.team_staff
   where team_id = 'cf000000-0eee-4000-8000-0000000000a1' and left_at is null;
  if v_open_active <> 0 then
    raise exception 'FAIL [S1]: el team_staff de la activa debería cerrarse, abiertos = %', v_open_active;
  end if;
  select count(*) into v_closed_active from public.team_staff
   where team_id = 'cf000000-0eee-4000-8000-0000000000a1' and left_at = date '2026-07-31';
  if v_closed_active <> 1 then
    raise exception 'FAIL [S1]: el team_staff de la activa debería tener left_at = fecha de corte';
  end if;

  -- team_staff del equipo de la UPCOMING (26-27): sigue ABIERTO.
  select count(*) into v_open_upcoming from public.team_staff
   where team_id = 'cf000000-0eee-4000-8000-0000000000a2' and left_at is null;
  if v_open_upcoming <> 1 then
    raise exception 'FAIL [S1]: el team_staff de la upcoming NO debe cerrarse, abiertos = %', v_open_upcoming;
  end if;
end $$;

reset role;

-- ═══ Club S2: guard cutoff_too_early considera team_staff ═════════════════════
insert into public.clubs (id, name, slug) values
  ('cf000000-0000-4000-8000-000000000002', 'Club CF2', 'club-cf2');

select pg_temp.new_test_user('cf0a0000-aaaa-4000-8000-000000000002', 'cf2admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cf0a0000-cccc-4000-8000-000000000002', 'cf2coach@test.local', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('cf0b0000-aaaa-4000-8000-000000000002', 'cf0a0000-aaaa-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000002', 'admin_club'),
  ('cf0b0000-cccc-4000-8000-000000000002', 'cf0a0000-cccc-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000002', 'entrenador_principal');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('cf000000-0dd0-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000000002', 'Cadete', 'cadete', 40, true);

insert into public.seasons (club_id, label, status) values
  ('cf000000-0000-4000-8000-000000000002', '2025-26', 'active'),
  ('cf000000-0000-4000-8000-000000000002', '2026-27', 'upcoming');

insert into public.teams (id, category_id, season, name, format, color) values
  ('cf000000-0eee-4000-8000-0000000000b1', 'cf000000-0dd0-4000-8000-00000000000b', '2025-26', 'Cadete A', 'F11', '#3B82F6');

-- Staff con joined_at POSTERIOR al cutoff y sin jugadores abiertos: solo el staff
-- puede disparar el guard. Sin el guard extendido, el UPDATE de team_staff violaría
-- el CHECK left_at>=joined_at con un error crudo.
insert into public.team_staff (team_id, membership_id, staff_role, joined_at) values
  ('cf000000-0eee-4000-8000-0000000000b1', 'cf0b0000-cccc-4000-8000-000000000002', 'entrenador_principal', '2026-08-15');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cf0a0000-aaaa-4000-8000-000000000002","role":"authenticated"}';

do $$
declare v_msg text; ok boolean := false;
begin
  begin
    perform public.finalize_active_season('cf000000-0000-4000-8000-000000000002', date '2026-07-31');
  exception when others then
    ok := true; v_msg := sqlerrm;
  end;
  if not ok then raise exception 'FAIL [S2]: finalizar con staff joined_at > cutoff debería fallar'; end if;
  if v_msg not like '%cutoff_too_early%' then
    raise exception 'FAIL [S2]: debería ser cutoff_too_early (guard), fue: %', v_msg;
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ O2: finalize_active_season cierra team_staff de la activa (upcoming intacto) y el guard cutoff_too_early considera al staff.'
\echo '──────────────────────────────────────────────'
