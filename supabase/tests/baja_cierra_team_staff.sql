-- Director-entrenador · S1b — la baja cierra las asignaciones team_staff.
-- Verifica el bloque añadido a set_membership_left (migración 20261053000000) y el
-- backfill. Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise 'FAIL[...]';
-- auth.uid() vía `set local "request.jwt.claims"`.
--
-- Fixture: club con admin, dos entrenadores ayudantes (C1 target, C2 control), un
-- director YA de baja (DB, para el backfill); dos equipos; team_staff ACTIVO para C1
-- (equipo 1), C2 (equipo 2) y DB (equipo 2, colgante). NO se necesita season (teams.season
-- es texto, no FK).
--
-- Casos:
--   T1. admin da de baja a C1 → su team_staff se CIERRA (misma fecha) y el de C2 (otro
--       miembro) queda INTACTO. Es el scoping del UPDATE ... FROM.
--   T2. reactivar C1 → membership activa de nuevo, pero su team_staff NO se reabre.
--   T3. backfill → cierra el team_staff colgante de DB (director de baja) en SU fecha de
--       baja, sin tocar el de C2 (miembro activo).
--   T4. backfill con alta POSTERIOR a la baja → clamp a joined_at (no viola el CHECK
--       team_staff_check: left_at >= joined_at).
\ir helpers/auth_users.sql

begin;

-- ── Usuarios ─────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('c5aa0000-0000-4000-8000-000000000001', 'bcts-admin@test.local', '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('c5aa0000-0000-4000-8000-000000000002', 'bcts-c1@test.local',    '{"full_name":"Coach C1"}'::jsonb);
select pg_temp.new_test_user('c5aa0000-0000-4000-8000-000000000003', 'bcts-c2@test.local',    '{"full_name":"Coach C2"}'::jsonb);
select pg_temp.new_test_user('c5aa0000-0000-4000-8000-000000000004', 'bcts-db@test.local',    '{"full_name":"Director DB"}'::jsonb);

-- ── Club, categoría, dos equipos ─────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('c5000000-0000-4000-8000-0000000000c1', 'Club BCTS', 'club-bcts');
insert into public.categories (id, club_id, name) values
  ('c5000000-0000-4000-8000-000000000ca1', 'c5000000-0000-4000-8000-0000000000c1', 'Cat BCTS');
insert into public.teams (id, category_id, name, format, color, season) values
  ('c5000000-0000-4000-8000-000000000701', 'c5000000-0000-4000-8000-000000000ca1', 'Equipo 1', 'F7', '#10B981', '2025-26'),
  ('c5000000-0000-4000-8000-000000000702', 'c5000000-0000-4000-8000-000000000ca1', 'Equipo 2', 'F7', '#10B981', '2025-26');

-- ── Memberships: admin/C1/C2 ACTIVOS; DB (director) YA DE BAJA (para el backfill) ─────
insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('c5dd0000-0000-4000-8000-000000000001','c5aa0000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-0000000000c1','admin_club',          null),
  ('c5dd0000-0000-4000-8000-000000000002','c5aa0000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null),
  ('c5dd0000-0000-4000-8000-000000000003','c5aa0000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null),
  ('c5dd0000-0000-4000-8000-000000000004','c5aa0000-0000-4000-8000-000000000004','c5000000-0000-4000-8000-0000000000c1','director',            date '2026-08-01');

-- ── team_staff (joined_at explícito para el CHECK left_at >= joined_at) ───────────────
--   C1 activo (eq.1), C2 activo (eq.2, control), y DB (director de baja 2026-08-01) con
--   DOS colgantes: uno con alta ANTES de la baja (→ backfill cierra en la baja) y otro
--   con alta DESPUÉS (→ backfill hace clamp a joined_at).
insert into public.team_staff (id, team_id, membership_id, staff_role, joined_at) values
  ('c5cc0000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000701','c5dd0000-0000-4000-8000-000000000002','entrenador_ayudante', date '2026-07-01'),
  ('c5cc0000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000702','c5dd0000-0000-4000-8000-000000000003','entrenador_ayudante', date '2026-07-01'),
  ('c5cc0000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000702','c5dd0000-0000-4000-8000-000000000004','delegado',            date '2026-07-15'),
  ('c5cc0000-0000-4000-8000-000000000004','c5000000-0000-4000-8000-000000000701','c5dd0000-0000-4000-8000-000000000004','delegado',            date '2026-09-15');

-- ══════════ T1 · baja cierra el team_staff del TARGET, no el de OTRO miembro ══════════
set local "request.jwt.claims" = '{"sub":"c5aa0000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.set_membership_left('c5000000-0000-4000-8000-0000000000c1','c5aa0000-0000-4000-8000-000000000002', date '2026-09-01', 'motivo interno');
do $$ begin
  -- El team_staff de C1 (target) queda CERRADO en la fecha de baja.
  if not exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000001' and left_at = date '2026-09-01'
  ) then raise exception 'FAIL[T1]: la baja debía CERRAR el team_staff del target en 2026-09-01'; end if;
  -- El team_staff de C2 (OTRO miembro) queda INTACTO (scoping del UPDATE ... FROM).
  if exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000002' and left_at is not null
  ) then raise exception 'FAIL[T1]: la baja NO debía tocar el team_staff de otro miembro (C2)'; end if;
  -- La membership del target queda de baja.
  if not exists (
    select 1 from public.memberships where id='c5dd0000-0000-4000-8000-000000000002' and left_at = date '2026-09-01'
  ) then raise exception 'FAIL[T1]: la membership del target debía quedar de baja'; end if;
end $$;

-- ══════════ T2 · reactivar NO reabre el team_staff ══════════
select public.set_membership_left('c5000000-0000-4000-8000-0000000000c1','c5aa0000-0000-4000-8000-000000000002', null, null);
do $$ begin
  -- Membership reactivada.
  if not exists (
    select 1 from public.memberships where id='c5dd0000-0000-4000-8000-000000000002' and left_at is null
  ) then raise exception 'FAIL[T2]: reactivar debía dejar la membership activa'; end if;
  -- Pero el team_staff SIGUE cerrado (no se reabre): hay que volver a asignar.
  if not exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000001' and left_at = date '2026-09-01'
  ) then raise exception 'FAIL[T2]: reactivar NO debía reabrir el team_staff (sigue cerrado en 2026-09-01)'; end if;
end $$;

-- ══════════ T3 · backfill cierra colgantes de miembros de baja, no de activos ══════════
-- Antes: el team_staff de DB (director de baja 2026-08-01) sigue ACTIVO (colgante).
do $$ begin
  if not exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000003' and left_at is null
  ) then raise exception 'FAIL[T3-pre]: el colgante de DB debía estar ACTIVO antes del backfill'; end if;
end $$;

-- Sentencia del backfill (la misma de la migración): greatest(baja, joined_at).
update public.team_staff ts
   set left_at = greatest(m.left_at, ts.joined_at)
  from public.memberships m
 where m.id = ts.membership_id
   and m.left_at is not null
   and ts.left_at is null;

do $$ begin
  -- El colgante de DB con alta ANTERIOR a la baja queda cerrado en la fecha de baja (2026-08-01).
  if not exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000003' and left_at = date '2026-08-01'
  ) then raise exception 'FAIL[T3]: el backfill debía cerrar el colgante de DB en su fecha de baja 2026-08-01'; end if;
  -- El team_staff de C2 (miembro ACTIVO) NO lo toca el backfill.
  if exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000002' and left_at is not null
  ) then raise exception 'FAIL[T3]: el backfill NO debía tocar el team_staff de un miembro activo (C2)'; end if;
end $$;

-- ══════════ T4 · clamp: colgante con alta POSTERIOR a la baja → left_at = joined_at ══════════
do $$ begin
  -- Alta 2026-09-15 > baja 2026-08-01: se cierra en joined_at (2026-09-15), no en la baja,
  -- para no violar team_staff_check (left_at >= joined_at).
  if not exists (
    select 1 from public.team_staff where id='c5cc0000-0000-4000-8000-000000000004' and left_at = date '2026-09-15'
  ) then raise exception 'FAIL[T4]: el backfill debía hacer clamp a joined_at (2026-09-15), no a la baja'; end if;
end $$;

rollback;
