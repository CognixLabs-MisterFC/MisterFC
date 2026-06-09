-- Rework A · A1 EXPAND — verifica el modelo nuevo de teams (season + club_id).
-- Migración 20260627000000_rework_a1_teams_season_expand.sql.
--
-- Convención del repo: psql ON_ERROR_STOP=1; los casos que DEBEN fallar van en un
-- DO con EXCEPTION capturando el SQLSTATE esperado; todo en BEGIN/ROLLBACK → no
-- deja rastro. Aquí son constraints de tabla (no RLS): superuser, sin role-switch.
--
-- Casos:
--   T1. backfill (simulado): un team insertado con la season/club_id de su
--       categoría coincide con ellos (lo que hizo el UPDATE one-shot de A1).
--   T2. unique(club_id, name, season): MISMO (club, name, season) → unique_violation.
--   T3. MISMO nombre en OTRA temporada (mismo club) → OK (equipos distintos por año).
--   T4. MISMO nombre+temporada en OTRO club → OK.
--   T5. season con formato inválido → check_violation (teams_season_format).
--   T6. club_id NULL al insertar → el trigger lo DERIVA de la categoría (no se
--       rechaza; queda = categories.club_id). Denormalización autoritativa.
--   T7. season NULL al insertar → el trigger la hereda de categories.season
--       (fallback transicional de A1).

begin;

insert into public.clubs (id, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'Club A1 A', 'club-a1-a'),
  ('a1000000-0000-4000-8000-000000000002', 'Club A1 B', 'club-a1-b');

-- Categorías (categories aún tiene season NOT NULL en A1 — no se toca hasta A4/A6).
insert into public.categories (id, club_id, name, season, kind) values
  ('a1000000-0dd0-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Infantil', '2025-26', 'infantil'),
  ('a1000000-0dd0-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Infantil', '2025-26', 'infantil');

-- ── T1. Backfill simulado: el team toma season/club_id de su categoría. ───────
do $$
declare v_season text; v_club uuid;
begin
  insert into public.teams (id, category_id, club_id, name, format, season)
    values ('a1000000-0ee1-4000-8000-000000000001', 'a1000000-0dd0-4000-8000-000000000001',
            'a1000000-0000-4000-8000-000000000001', 'Infantil A', 'F11', '2025-26')
    returning season, club_id into v_season, v_club;
  if v_season <> '2025-26' or v_club <> 'a1000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [T1]: season/club_id del team deberían ser los de su categoría (got %, %)', v_season, v_club;
  end if;
end $$;

-- ── T2. unique(club_id, name, season): duplicado exacto → unique_violation. ────
do $$ begin
  begin
    insert into public.teams (category_id, club_id, name, format, season)
      values ('a1000000-0dd0-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Infantil A', 'F7', '2025-26');
    raise exception 'FAIL [T2]: mismo (club, name, season) debería rechazarse';
  exception when unique_violation then null; end;
end $$;

-- ── T3. mismo nombre, OTRA temporada (mismo club) → OK. ───────────────────────
do $$ begin
  insert into public.teams (category_id, club_id, name, format, season)
    values ('a1000000-0dd0-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Infantil A', 'F11', '2026-27');
exception when unique_violation then
  raise exception 'FAIL [T3]: el mismo nombre en otra temporada debería permitirse';
end $$;

-- ── T4. mismo nombre+temporada, OTRO club → OK. ───────────────────────────────
do $$ begin
  insert into public.teams (category_id, club_id, name, format, season)
    values ('a1000000-0dd0-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Infantil A', 'F11', '2025-26');
exception when unique_violation then
  raise exception 'FAIL [T4]: el mismo nombre+temporada en otro club debería permitirse';
end $$;

-- ── T5. season con formato inválido → check_violation. ────────────────────────
do $$ begin
  begin
    insert into public.teams (category_id, club_id, name, format, season)
      values ('a1000000-0dd0-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Cadete A', 'F11', '2025');
    raise exception 'FAIL [T5]: season "2025" (formato inválido) debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- ── T6. club_id NULL → el trigger lo deriva de la categoría (no se rechaza). ───
do $$
declare v_club uuid;
begin
  insert into public.teams (category_id, club_id, name, format, season)
    values ('a1000000-0dd0-4000-8000-000000000001', null, 'Cadete B', 'F11', '2025-26')
    returning club_id into v_club;
  if v_club is distinct from 'a1000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [T6]: el trigger debería derivar club_id de la categoría (got %)', v_club;
  end if;
end $$;

-- ── T7. season NULL → el trigger la hereda de categories.season. ──────────────
do $$
declare v_season text;
begin
  insert into public.teams (category_id, club_id, name, format, season)
    values ('a1000000-0dd0-4000-8000-000000000001', null, 'Cadete C', 'F11', null)
    returning season into v_season;
  if v_season <> '2025-26' then
    raise exception 'FAIL [T7]: season NULL debería heredarse de la categoría (got %)', v_season;
  end if;
end $$;

rollback;
