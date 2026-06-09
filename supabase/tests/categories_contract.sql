-- Rework A · A6 CONTRACT — verifica el estado final de categories.
-- Migración 20260630000000_rework_a6_categories_contract.sql.
--
-- Convención del repo: psql ON_ERROR_STOP=1; los casos que DEBEN fallar van en un
-- DO con EXCEPTION capturando el SQLSTATE esperado; todo en BEGIN/ROLLBACK → no
-- deja rastro. Constraints/trigger de tabla: superuser, sin role-switch.
--
-- Casos:
--   U1. unique(club_id, lower(name)) — duplicado case-insensitive → unique_violation.
--   U2. mismo nombre en OTRO club → OK.
--   G1. trigger teams_derive_from_category sigue derivando club_id (insert con
--       club_id NULL → toma el de la categoría).
--   G2. insert de team SIN season → not_null_violation (el fallback de season se
--       retiró en A6; la season la aporta /equipos).
--   D1. dedup re-apunta teams.category_id y events.category_id al superviviente y
--       borra la categoría duplicada (fixture con 2 categorías mismo nombre).

begin;

insert into public.clubs (id, name, slug) values
  ('a6000000-0000-4000-8000-000000000001', 'Club A6 A', 'club-a6-a'),
  ('a6000000-0000-4000-8000-000000000002', 'Club A6 B', 'club-a6-b');

-- ── U1/U2. Unicidad (club_id, lower(name)) ───────────────────────────────────
insert into public.categories (id, club_id, name, kind) values
  ('a6000000-0dd0-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'Cadete', 'cadete');

do $$ begin
  begin
    insert into public.categories (club_id, name, kind)
      values ('a6000000-0000-4000-8000-000000000001', 'cadete', 'cadete'); -- mismo nombre, distinta caja
    raise exception 'FAIL [U1]: (club, lower(name)) duplicado debería rechazarse';
  exception when unique_violation then null; end;
end $$;

do $$ begin
  insert into public.categories (club_id, name, kind)
    values ('a6000000-0000-4000-8000-000000000002', 'Cadete', 'cadete'); -- otro club → OK
exception when unique_violation then
  raise exception 'FAIL [U2]: el mismo nombre en otro club debería permitirse';
end $$;

-- ── G1/G2. Trigger: deriva club_id; ya NO deriva season ──────────────────────
do $$
declare v_club uuid;
begin
  -- club_id NULL → el trigger lo deriva de la categoría.
  insert into public.teams (category_id, club_id, name, format, season)
    values ('a6000000-0dd0-4000-8000-000000000001', null, 'Cadete A', 'F11', '2025-26')
    returning club_id into v_club;
  if v_club is distinct from 'a6000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [G1]: el trigger debería derivar club_id de la categoría (got %)', v_club;
  end if;
end $$;

do $$ begin
  begin
    -- season NULL → ya no se hereda (A6 quitó el fallback) → NOT NULL.
    insert into public.teams (category_id, club_id, name, format, season)
      values ('a6000000-0dd0-4000-8000-000000000001',
              'a6000000-0000-4000-8000-000000000001', 'Cadete B', 'F11', null);
    raise exception 'FAIL [G2]: team sin season debería fallar por NOT NULL';
  exception when not_null_violation then null; end;
end $$;

-- ── D1. Dedup re-apunta teams/events y borra la duplicada ────────────────────
-- La unicidad recién creada impide crear el escenario duplicado, así que la
-- soltamos DENTRO de la transacción (el ROLLBACK la restaura) para reproducir el
-- caso general que la migración debe resolver.
drop index public.categories_club_name_uniq;

-- profile para events.created_by (auth.users → profile por trigger, ver rls_events).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values ('a6000000-aaaa-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'a6@contract.test', now(), '{}'::jsonb, now(), now());

-- 2 categorías mismo (club, lower(name)); el superviviente es la más antigua.
insert into public.categories (id, club_id, name, kind, created_at) values
  ('a6000000-0dd0-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', '2024-01-01T00:00:00Z'), -- keeper
  ('a6000000-0dd0-4000-8000-0000000000a2', 'a6000000-0000-4000-8000-000000000001', 'Infantil', 'infantil', '2025-01-01T00:00:00Z'); -- dup

-- team y event apuntando a la DUPLICADA (la más nueva).
insert into public.teams (id, category_id, club_id, name, format, season)
  values ('a6000000-0ee0-4000-8000-0000000000a2', 'a6000000-0dd0-4000-8000-0000000000a2',
          'a6000000-0000-4000-8000-000000000001', 'Infantil A', 'F11', '2025-26');

insert into public.events (id, club_id, category_id, type, title, starts_at, created_by)
  values ('a6000000-0ff0-4000-8000-0000000000a2', 'a6000000-0000-4000-8000-000000000001',
          'a6000000-0dd0-4000-8000-0000000000a2', 'training', 'Entreno Infantil',
          now(), 'a6000000-aaaa-4000-8000-000000000001');

-- Dedup (mismas sentencias que la migración).
with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn,
         first_value(id) over (partition by club_id, lower(name) order by created_at, id) as keeper
    from public.categories
)
update public.teams t set category_id = r.keeper from ranked r
 where t.category_id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn,
         first_value(id) over (partition by club_id, lower(name) order by created_at, id) as keeper
    from public.categories
)
update public.events e set category_id = r.keeper from ranked r
 where e.category_id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn
    from public.categories
)
delete from public.categories c using ranked r where c.id = r.id and r.rn > 1;

do $$
declare v_team_cat uuid; v_event_cat uuid; v_dup_exists boolean;
begin
  select category_id into v_team_cat from public.teams
    where id = 'a6000000-0ee0-4000-8000-0000000000a2';
  select category_id into v_event_cat from public.events
    where id = 'a6000000-0ff0-4000-8000-0000000000a2';
  select exists(select 1 from public.categories where id = 'a6000000-0dd0-4000-8000-0000000000a2')
    into v_dup_exists;

  if v_team_cat is distinct from 'a6000000-0dd0-4000-8000-0000000000a1' then
    raise exception 'FAIL [D1]: teams.category_id debería re-apuntar al superviviente (got %)', v_team_cat;
  end if;
  if v_event_cat is distinct from 'a6000000-0dd0-4000-8000-0000000000a1' then
    raise exception 'FAIL [D1]: events.category_id debería re-apuntar al superviviente (got %)', v_event_cat;
  end if;
  if v_dup_exists then
    raise exception 'FAIL [D1]: la categoría duplicada debería haberse borrado';
  end if;
end $$;

rollback;
