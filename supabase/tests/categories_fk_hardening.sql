-- Rework C · C4 CONTRACT — verifica el blindaje de FKs a categories.
-- Migración 20260705000000_rework_c4_harden_category_fks.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; los casos que DEBEN fallar van en un DO
-- con EXCEPTION capturando el SQLSTATE esperado.
--
-- Casos:
--   R1. teams.category_id = RESTRICT → borrar una categoría CON equipos falla
--       (foreign_key_violation). Protege equipos + histórico.
--   S1. events.category_id = SET NULL → borrar una categoría con un evento (y sin
--       equipos) SÍ borra la categoría; el evento se CONSERVA con category_id NULL.
--   D1. Categoría SIN referencias → borrado permitido.
\ir helpers/auth_users.sql

begin;

-- Setup: club + un user (su profile lo crea el trigger handle_new_user) para created_by.
insert into public.clubs (id, name, slug) values
  ('c4000000-0000-4000-8000-000000000001', 'Club C4', 'club-c4');

select pg_temp.new_test_user('c4000000-0aaa-4000-8000-000000000001', 'c4user@test.local', '{"full_name":"C4 User"}'::jsonb);

-- ── R1. RESTRICT: categoría con equipo no se puede borrar ────────────────────
insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c4000000-0dd0-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', 35, true);

insert into public.teams (id, category_id, season, name, format, color) values
  ('c4000000-0eee-4000-8000-000000000001', 'c4000000-0dd0-4000-8000-000000000001', '2026-27', 'Infantil A', 'F11', '#10B981');

do $$ begin
  begin
    delete from public.categories where id = 'c4000000-0dd0-4000-8000-000000000001';
    raise exception 'FAIL [R1]: borrar una categoría con equipos debería fallar (RESTRICT)';
  exception when foreign_key_violation then null; end;
end $$;

-- ── S1. SET NULL: categoría con evento (sin equipos) → evento se conserva ─────
insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c4000000-0dd0-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001', 'Cadete', 'cadete', 40, true);

insert into public.events (id, club_id, category_id, type, title, starts_at, created_by) values
  ('c4000000-0fff-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'c4000000-0dd0-4000-8000-000000000002', 'training', 'Entreno', now(),
   'c4000000-0aaa-4000-8000-000000000001');

delete from public.categories where id = 'c4000000-0dd0-4000-8000-000000000002';

do $$
declare v_cat int; v_cid uuid;
begin
  select count(*) into v_cat from public.categories where id = 'c4000000-0dd0-4000-8000-000000000002';
  if v_cat <> 0 then raise exception 'FAIL [S1]: la categoría sin equipos debería poder borrarse'; end if;

  -- El evento sigue existiendo, con category_id puesto a NULL.
  select category_id into v_cid from public.events where id = 'c4000000-0fff-4000-8000-000000000001';
  if not found then raise exception 'FAIL [S1]: el evento NO debería borrarse (SET NULL, no CASCADE)'; end if;
  if v_cid is not null then raise exception 'FAIL [S1]: events.category_id debería quedar NULL, es %', v_cid; end if;
end $$;

-- ── D1. Categoría sin referencias → borrado permitido ────────────────────────
insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c4000000-0dd0-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000001', 'Alevín', 'alevin', 30, true);

delete from public.categories where id = 'c4000000-0dd0-4000-8000-000000000003';

do $$
declare v_cat int;
begin
  select count(*) into v_cat from public.categories where id = 'c4000000-0dd0-4000-8000-000000000003';
  if v_cat <> 0 then raise exception 'FAIL [D1]: categoría sin referencias debería borrarse'; end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C4: FKs blindadas (teams RESTRICT, events SET NULL).'
\echo '──────────────────────────────────────────────'
