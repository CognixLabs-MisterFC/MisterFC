-- Rework A · A6 CONTRACT — la categoría queda plantilla permanente del club.
--
-- Spec: docs/specs/A.0-categorias-equipos.md §5 (Migración 2 / CONTRACT) / §9 / §3.1.
-- ADR-0017. IRREVERSIBLE: borra categories.season/order_idx y deduplica.
--
-- Precondición (garantizada por A2–A5, ya en remoto): NADA lee categories.season.
-- La temporada vive en teams.season (A1). Orden de pasos crítico:
--   1) SALVAGUARDA: teams.season poblado en todas las filas → si no, ABORTA.
--   2) DEDUP: colapsa categorías que solo difieren por temporada (mismo club +
--      lower(name)); re-apunta teams.category_id y events.category_id al
--      superviviente (más antiguo) y borra las duplicadas.
--   3) DROP de season, order_idx, índice categories_club_season_idx y comentario.
--   4) UNIQUE(club_id, lower(name)) — ya posible tras la dedup.
--   5) TRIGGER teams_derive_from_category: quitar el fallback de season (la
--      columna ya no existe); la derivación de club_id se mantiene.
-- Todo en una migración → transaccional: si un paso falla, no se aplica nada.

-- ── 1. SALVAGUARDA ────────────────────────────────────────────────────────────
-- El NOT NULL de teams.season (A1) ya lo garantiza; verificación defensiva ANTES
-- de tocar categories. Si algo no cuadra, abortamos toda la migración.
do $$
declare v_missing bigint;
begin
  select count(*) into v_missing from public.teams where season is null;
  if v_missing > 0 then
    raise exception
      'ABORT A6 CONTRACT: % equipos sin season; la temporada no está totalmente migrada al equipo. No se toca categories.',
      v_missing;
  end if;
end $$;

-- ── 2. DEDUP de categorías ──────────────────────────────────────────────────
-- Por (club_id, lower(name)) con >1 fila: superviviente determinista = el más
-- antiguo (created_at, id como desempate). Se re-apuntan teams y events a él y se
-- borran las duplicadas. kind/half_duration_minutes son iguales por nombre, así
-- que el superviviente los conserva. Con los datos actuales (sin duplicados) no
-- fusiona nada; escrito robusto para el caso general.
with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn,
         first_value(id) over (partition by club_id, lower(name) order by created_at, id) as keeper
    from public.categories
)
update public.teams t
   set category_id = r.keeper
  from ranked r
 where t.category_id = r.id
   and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn,
         first_value(id) over (partition by club_id, lower(name) order by created_at, id) as keeper
    from public.categories
)
update public.events e
   set category_id = r.keeper
  from ranked r
 where e.category_id = r.id
   and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by club_id, lower(name) order by created_at, id) as rn
    from public.categories
)
delete from public.categories c
 using ranked r
 where c.id = r.id
   and r.rn > 1;

-- Verificación post-dedup: no puede quedar ningún (club_id, lower(name)) repetido
-- (si quedara, el UNIQUE de abajo fallaría; abortamos con mensaje claro).
do $$
declare v_dups bigint;
begin
  select count(*) into v_dups from (
    select 1 from public.categories
     group by club_id, lower(name)
    having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'ABORT A6 CONTRACT: % grupos (club, nombre) siguen duplicados tras la dedup', v_dups;
  end if;
end $$;

-- ── 3. DROP de season / order_idx / índice / comentario ─────────────────────
drop index if exists public.categories_club_season_idx;
alter table public.categories drop column season;       -- arrastra categories_season_check
alter table public.categories drop column order_idx;

comment on table public.categories is
  'Plantilla permanente de categoría del club (name + kind + half_duration_minutes). NO tiene temporada: la temporada vive en teams.season. El orden de listado se deriva de kind (CATEGORY_KIND_ORDER, O1).';

-- ── 4. Nueva unicidad de plantilla ──────────────────────────────────────────
create unique index categories_club_name_uniq
  on public.categories (club_id, lower(name));

-- ── 5. Trigger: quitar el fallback de season (mantener la derivación de club_id) ─
create or replace function public.teams_derive_from_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.categories%rowtype;
begin
  select * into v_cat from public.categories where id = new.category_id;
  if not found then
    raise exception 'category_not_found' using errcode = 'foreign_key_violation';
  end if;

  new.club_id := v_cat.club_id;   -- siempre (denormalización autoritativa)

  -- A6 CONTRACT — el fallback de season se RETIRA: categories.season ya no existe.
  -- La season la aporta SIEMPRE el flujo /equipos (A4); un insert sin season debe
  -- fallar por el NOT NULL de teams.season (correcto).
  return new;
end;
$$;

comment on function public.teams_derive_from_category() is
  'Rework A (A6) — deriva teams.club_id desde la categoría (denormalización autoritativa) antes de los checks. El fallback de season se retiró en A6 CONTRACT (categories.season ya no existe); la season la aporta el flujo /equipos y un insert sin ella falla por NOT NULL.';
