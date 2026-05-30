-- F4.9 — Estándares de duración de partido por categoría.
--
-- Cada categoría tiene una duración por tiempo (half) — depende del rango
-- de edad. Hasta ahora la duración no se modelaba en ningún sitio: el form
-- de "crear evento partido" pedía ends_at manual y los coaches lo rellenaban
-- a ojo. Con esta migración:
--
--   1. Añadimos `categories.half_duration_minutes` (INT, default 45).
--   2. Backfill por nombre normalizado (case-insensitive + sin tilde) con
--      los estándares españoles oficiales:
--          querubín    → 15
--          prebenjamín → 20
--          benjamín    → 25
--          alevín      → 30
--          infantil    → 35
--          cadete      → 40
--          juvenil     → 45
--          amateur     → 45
--          senior      → 45  (algunos clubs lo usan en vez de amateur)
--          veterano    → 45
--      Cualquier nombre que no matchee se queda con default 45.
--   3. Detección con prefijo: "Prebenjamín B", "Cadete A 2025", etc.
--      reciben el valor correcto sin necesidad de match exacto.
--
-- La duración total del partido = 2 × half_duration_minutes (dos tiempos
-- + descanso despreciable a efectos de planificación). La UI calcula
-- ends_at sugerido como starts_at + 2 × half_duration_minutes.

create extension if not exists unaccent;

alter table public.categories
  add column half_duration_minutes integer not null default 45
  check (half_duration_minutes > 0 and half_duration_minutes <= 90);

comment on column public.categories.half_duration_minutes is
  'F4.9 — duración de cada tiempo de partido en minutos. Default 45 (amateur/senior). Categorías base españolas backfilleadas en la migración: querubín 15, prebenjamín 20, benjamín 25, alevín 30, infantil 35, cadete 40, juvenil/amateur/senior/veterano 45. Editable por admin/coord.';

-- Backfill por nombre normalizado (sin tilde, lowercase, prefijo).
do $$
declare
  c record;
  norm text;
  new_val integer;
begin
  for c in select id, name from public.categories loop
    norm := lower(unaccent(c.name));
    new_val := case
      when norm like 'querubin%'     then 15
      when norm like 'prebenjamin%'  then 20
      when norm like 'benjamin%'     then 25
      when norm like 'alevin%'       then 30
      when norm like 'infantil%'     then 35
      when norm like 'cadete%'       then 40
      when norm like 'juvenil%'      then 45
      when norm like 'amateur%'      then 45
      when norm like 'senior%'       then 45
      when norm like 'veterano%'     then 45
      else null
    end;
    if new_val is not null then
      update public.categories
         set half_duration_minutes = new_val
       where id = c.id;
    end if;
  end loop;
end $$;
