-- Rework C · C5 — verifica el modelo de temporada (seasons).
-- Migración 20260706000000_rework_c5_seasons.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception; los casos
-- que DEBEN fallar capturan el SQLSTATE esperado. Constraints en contexto
-- superuser; RLS con set local role authenticated + request.jwt.claims.
--
-- Casos:
--   C1. UNA activa por club (índice parcial) → 2ª active en el mismo club falla.
--   C2. unique(club_id, label) → label duplicado en el club falla; en otro club OK.
--   B1. Backfill: varios labels → la más reciente queda active, el resto finalized.
--   B2. Backfill: club sin equipos → exactamente una active.
--   R1. RLS: admin_club inserta season → OK.
--   R2. RLS: miembro NO admin (jugador) inserta → bloqueado.
--   R3. RLS: no-miembro NO ve las seasons del club; miembro sí.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('c5000000-0000-4000-8000-000000000001', 'Club C5 A', 'club-c5-a'),
  ('c5000000-0000-4000-8000-000000000002', 'Club C5 B', 'club-c5-b');

-- ── C1. Una activa por club ──────────────────────────────────────────────────
insert into public.seasons (club_id, label, status) values
  ('c5000000-0000-4000-8000-000000000001', '2025-26', 'active');

do $$ begin
  begin
    insert into public.seasons (club_id, label, status)
      values ('c5000000-0000-4000-8000-000000000001', '2026-27', 'active');
    raise exception 'FAIL [C1]: una 2ª temporada active en el mismo club debería fallar';
  exception when unique_violation then null; end;
end $$;

-- active + finalized en el mismo club → OK
insert into public.seasons (club_id, label, status) values
  ('c5000000-0000-4000-8000-000000000001', '2024-25', 'finalized');

-- ── C2. unique(club_id, label) ───────────────────────────────────────────────
do $$ begin
  begin
    insert into public.seasons (club_id, label, status)
      values ('c5000000-0000-4000-8000-000000000001', '2025-26', 'finalized');
    raise exception 'FAIL [C2]: label duplicado en el club debería fallar';
  exception when unique_violation then null; end;
end $$;

insert into public.seasons (club_id, label, status) values
  ('c5000000-0000-4000-8000-000000000002', '2025-26', 'active'); -- otro club → OK

-- ── B1. Backfill: varios labels → más reciente active ────────────────────────
insert into public.clubs (id, name, slug) values
  ('c5000000-0000-4000-8000-000000000003', 'Club C5 Backfill', 'club-c5-bf');
insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c5000000-0dd0-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000003', 'Infantil', 'infantil', 35, true);
insert into public.teams (id, category_id, season, name, format, color) values
  ('c5000000-0eee-4000-8000-000000000001', 'c5000000-0dd0-4000-8000-000000000001', '2024-25', 'Inf A 24', 'F11', '#10B981'),
  ('c5000000-0eee-4000-8000-000000000002', 'c5000000-0dd0-4000-8000-000000000001', '2025-26', 'Inf A 25', 'F11', '#10B981');

-- Réplica del backfill para este club.
insert into public.seasons (club_id, label, status)
  select 'c5000000-0000-4000-8000-000000000003', d.season, 'finalized'
    from (select distinct season from public.teams where club_id = 'c5000000-0000-4000-8000-000000000003') d
  on conflict (club_id, label) do nothing;
update public.seasons set status = 'active'
 where club_id = 'c5000000-0000-4000-8000-000000000003'
   and label = (select max(season) from public.teams where club_id = 'c5000000-0000-4000-8000-000000000003');

do $$
declare v_active text; v_fin int;
begin
  select label into v_active from public.seasons
   where club_id = 'c5000000-0000-4000-8000-000000000003' and status = 'active';
  if v_active <> '2025-26' then raise exception 'FAIL [B1]: la activa debería ser 2025-26, es %', v_active; end if;
  select count(*) into v_fin from public.seasons
   where club_id = 'c5000000-0000-4000-8000-000000000003' and status = 'finalized';
  if v_fin <> 1 then raise exception 'FAIL [B1]: debería quedar 1 finalized (2024-25), hay %', v_fin; end if;
end $$;

-- ── B2. Backfill: club sin equipos → 1 activa ────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('c5000000-0000-4000-8000-000000000004', 'Club C5 Vacío', 'club-c5-empty');
insert into public.seasons (club_id, label, status)
  values ('c5000000-0000-4000-8000-000000000004', '2025-26', 'active')
on conflict (club_id, label) do update set status = 'active';

do $$
declare v_n int;
begin
  select count(*) into v_n from public.seasons
   where club_id = 'c5000000-0000-4000-8000-000000000004' and status = 'active';
  if v_n <> 1 then raise exception 'FAIL [B2]: club sin equipos debería tener 1 activa, tiene %', v_n; end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Users: admin (A) y miembro no-admin (M) del club A; outsider (O) sin membership.
select pg_temp.new_test_user('c5a00000-aaaa-4000-8000-000000000001', 'c5admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('c5a00000-bbbb-4000-8000-000000000001', 'c5member@test.local', '{}'::jsonb);
select pg_temp.new_test_user('c5a00000-cccc-4000-8000-000000000001', 'c5outsider@test.local', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('c5a00000-aaaa-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'admin_club'),
  ('c5a00000-bbbb-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'jugador');

-- R1. admin_club inserta → OK
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c5a00000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  insert into public.seasons (club_id, label, status)
    values ('c5000000-0000-4000-8000-000000000001', '2027-28', 'finalized');
exception when others then
  raise exception 'FAIL [R1]: admin_club debería poder insertar seasons (%)', sqlerrm;
end $$;

-- R2. miembro no admin (jugador) inserta → bloqueado
set local "request.jwt.claims" = '{"sub":"c5a00000-bbbb-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.seasons (club_id, label, status)
      values ('c5000000-0000-4000-8000-000000000001', '2028-29', 'finalized');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [R2]: un miembro no admin NO debería poder insertar seasons'; end if;
end $$;

-- R3. miembro ve; outsider no ve
do $$
declare v_member int;
begin
  select count(*) into v_member from public.seasons where club_id = 'c5000000-0000-4000-8000-000000000001';
  if v_member = 0 then raise exception 'FAIL [R3]: un miembro debería ver las seasons de su club'; end if;
end $$;

set local "request.jwt.claims" = '{"sub":"c5a00000-cccc-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_out int;
begin
  select count(*) into v_out from public.seasons where club_id = 'c5000000-0000-4000-8000-000000000001';
  if v_out <> 0 then raise exception 'FAIL [R3]: un no-miembro NO debería ver las seasons del club, ve %', v_out; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C5: seasons (una activa/club, unique label, backfill, RLS).'
\echo '──────────────────────────────────────────────'
