-- Rework A · A1 EXPAND — la temporada baja de la categoría al EQUIPO.
--
-- Spec: docs/specs/A.0-categorias-equipos.md §3.2 / §5 (Migración 1) / §9.
-- ADR: docs/decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md.
--
-- ADITIVA y de bajo riesgo: SOLO toca `teams`. NO toca `categories` (sigue con
-- season/order_idx NOT NULL como hoy → todo lo que aún lee category.season sigue
-- funcionando; el migrate de los lectores es A2/A3 y el nullable de categories es
-- A4). Patrón EXPAND→MIGRATE→CONTRACT: aquí solo EXPAND.
--
--   · teams.season  (YYYY-YY)  — backfill desde la categoría, luego NOT NULL.
--   · teams.club_id (denormalizado, D3) — backfill desde category.club_id, luego
--     NOT NULL. Necesario para la unicidad por club+temporada (la constraint no
--     puede mirar la club_id de la categoría sin trigger/columna generada).
--   · unique(club_id, name, season) + índice (club_id, season).

-- 1. Columnas nuevas (nullable de inicio para poder backfillear).
alter table public.teams add column season  text;
alter table public.teams add column club_id uuid references public.clubs(id) on delete cascade;

-- 2. Backfill desde la categoría actual (team → category.season / category.club_id).
update public.teams t
   set season  = c.season,
       club_id = c.club_id
  from public.categories c
 where c.id = t.category_id;

-- 3. Endurecer: NOT NULL + check de formato + unicidad por (club, nombre, temporada).
alter table public.teams
  alter column season  set not null,
  add constraint teams_season_format check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  alter column club_id set not null,
  add constraint teams_club_name_season_uniq unique (club_id, name, season);

create index teams_club_season_idx on public.teams (club_id, season);

comment on column public.teams.season is
  'Rework A — temporada del equipo (YYYY-YY). La categoría es permanente; la temporada vive aquí. Backfilleada desde la categoría en A1.';
comment on column public.teams.club_id is
  'Rework A — club del equipo, denormalizado desde la categoría (D3) para la unicidad unique(club_id, name, season). No cambia en la vida del equipo.';
