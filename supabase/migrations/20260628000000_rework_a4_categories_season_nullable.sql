-- Rework A · A4 MIGRATE — categories.season / order_idx → NULLABLE.
--
-- Spec: docs/specs/A.0-categorias-equipos.md §3.1 / §5 (MIGRATE) / §9.
-- ADR-0017 (temporada en el equipo; categoría como plantilla permanente).
--
-- Migración ADITIVA y de bajo riesgo: SOLO ablanda dos columnas de `categories`.
-- NO borra, NO deduplica, NO cambia la unicidad (eso es A6 CONTRACT). Tras A2/A3
-- ningún lector de display/DTO depende ya de categories.season, así que volverla
-- NULLABLE no rompe el typecheck (database.ts pasa season/order_idx a `| null`).
--
-- Con esto, la pantalla de categorías-plantilla (A4, /equipos/plantillas) puede
-- crear una categoría permanente SOLO con name + kind + half_duration_minutes,
-- sin season ni order_idx. La temporada ya vive en teams.season (A1).
--
-- Nota sobre el trigger teams_derive_from_category (A1, 20260627000001): mantiene
-- el fallback `if new.season is null then new.season := v_cat.season`. En A4 NO se
-- toca: el flujo /equipos aporta SIEMPRE season explícita, así que el fallback no
-- se dispara para las plantillas sin season. Su retirada es A6 CONTRACT.

-- 1. season → NULLABLE + check "NULL o regex YYYY-YY".
alter table public.categories alter column season drop not null;

-- El check inline original (categories_season_check: `season ~ '...'`) ya tolera
-- NULL (un CHECK pasa si evalúa TRUE o NULL), pero lo recreamos explícito para
-- que la intención "NULL o regex" quede en el esquema.
alter table public.categories drop constraint if exists categories_season_check;
alter table public.categories
  add constraint categories_season_check
  check (season is null or season ~ '^[0-9]{4}-[0-9]{2}$');

-- 2. order_idx → NULLABLE (deja de ser orden manual; el orden se deriva de kind,
--    CATEGORY_KIND_ORDER / O1). Se conserva el default 0 para inserts legacy.
alter table public.categories alter column order_idx drop not null;

comment on column public.categories.season is
  'Rework A (A4) — NULLABLE. La temporada vive en teams.season; una categoría-plantilla nueva no la lleva. Las filas legacy aún la conservan hasta A6 (dedup + DROP).';
comment on column public.categories.order_idx is
  'Rework A (A4) — NULLABLE y en desuso. El orden de listado se deriva de kind (CATEGORY_KIND_ORDER, O1). Se elimina en A6.';
