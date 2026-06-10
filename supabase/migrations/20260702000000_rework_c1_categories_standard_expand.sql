-- Rework C · C1 EXPAND — catálogo estándar de categorías como datos.
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§2, §4 D-a/D-d, §5 C1).
-- ADITIVA y NO destructiva. Patrón EXPAND→MIGRATE→CONTRACT (como Rework A):
-- aquí solo EXPAND. NO retira UI ni toca las categorías custom (eso es C3/C4).
--
--   1. categories.is_standard (bool, default false) — marca las del catálogo
--      estándar de fútbol base. Las custom (A4) quedan is_standard=false.
--   2. public.seed_standard_categories(club_id) — siembra IDEMPOTENTE del catálogo
--      canónico (kind, name es-ES/CV, half_duration). Reutilizable: C2 la llamará
--      desde create_club_with_admin al crear club.
--   3. Backfill: ejecuta la función para todos los clubes existentes.
--
-- Catálogo canónico (fiel al código, NO inventado):
--   · kind + orden   → packages/core/src/schemas/club-structure.ts (CATEGORY_KIND_ORDER, O1)
--   · half_duration  → migración 20260605000003_categories_half_duration.sql
--   · name es-ES/CV  → i18n category_kinds (messages/es.json)
--   querubin/Querubín/15, prebenjamin/Prebenjamín/20, benjamin/Benjamín/25,
--   alevin/Alevín/30, infantil/Infantil/35, cadete/Cadete/40, juvenil/Juvenil/45,
--   amateur/Amateur/45, senior/Sénior/45, veterano/Veterano/45.
--
-- Idempotencia / no destructivo (clave): por cada kind canónico,
--   · si el club YA tiene una categoría de ese kind (estándar o no) → NO se toca
--     (se respeta la custom; evita el unique(club_id, lower(name))).
--   · si existe una categoría con ESE nombre (case-insensitive) → NO se toca
--     (evita la colisión de nombre con una custom homónima).
--   · si no hay solape → se INSERTA la estándar con is_standard=true.
-- Re-ejecutar no duplica ni modifica filas existentes. Los kinds saltados por
-- solape se reconcilian en C3 (MIGRATE), con visibilidad del admin.

-- ── 1. Columna is_standard ───────────────────────────────────────────────────
alter table public.categories
  add column is_standard boolean not null default false;

comment on column public.categories.is_standard is
  'Rework C (C1) — true = categoría del catálogo estándar de fútbol base (sembrada por seed_standard_categories). false = categoría custom creada por el club en A4 (grandfathered). El alta de categorías se retira en C4; el club solo crea equipos.';

-- ── 2. Función de sembrado idempotente ───────────────────────────────────────
create or replace function public.seed_standard_categories(p_club_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_cat record;
begin
  for v_cat in
    select * from (values
      ('querubin',    'Querubín',    15),
      ('prebenjamin', 'Prebenjamín', 20),
      ('benjamin',    'Benjamín',    25),
      ('alevin',      'Alevín',      30),
      ('infantil',    'Infantil',    35),
      ('cadete',      'Cadete',      40),
      ('juvenil',     'Juvenil',     45),
      ('amateur',     'Amateur',     45),
      ('senior',      'Sénior',      45),
      ('veterano',    'Veterano',    45)
    ) as c(kind, name, half_duration_minutes)
  loop
    -- No tocar si ya hay una categoría de ese kind o con ese nombre en el club
    -- (idempotencia + respeto a las custom + evita unique(club_id, lower(name))).
    if exists (
      select 1 from public.categories
       where club_id = p_club_id
         and (kind = v_cat.kind or lower(name) = lower(v_cat.name))
    ) then
      continue;
    end if;

    insert into public.categories (club_id, name, kind, half_duration_minutes, is_standard)
      values (p_club_id, v_cat.name, v_cat.kind, v_cat.half_duration_minutes, true);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

comment on function public.seed_standard_categories(uuid) is
  'Rework C (C1) — siembra IDEMPOTENTE del catálogo estándar (10 kinds canónicos con half_duration y nombre es-ES) en un club. No duplica, no toca categorías existentes (custom o de kind/nombre coincidente). Reutilizada por create_club_with_admin (C2). Devuelve nº de filas insertadas.';

-- ── 3. Backfill de clubes existentes ─────────────────────────────────────────
do $$
declare
  v_club record;
begin
  for v_club in select id from public.clubs loop
    perform public.seed_standard_categories(v_club.id);
  end loop;
end $$;
