-- Fix #13 — corrige categories.half_duration_minutes que quedaron en el default 45.
--
-- Contexto: el backfill de 20260605000003 mapeó nombre→duración UNA sola vez y por
-- PREFIJO (`like 'infantil%'`). Las categorías creadas DESPUÉS de esa migración, o
-- con nombres que no empiezan por el prefijo esperado, se quedaron con el default
-- (45) aunque su kind tuviera otra duración (p.ej. "Infantil" creada más tarde → 45
-- en vez de 35).
--
-- Esta migración RE-APLICA el MISMO mapeo de duraciones por kind que fijó
-- 20260605000003 (no se inventan valores), pero de forma más ROBUSTA:
--   · unaccent + lower (insensible a tildes/mayúsculas) — igual que el original.
--   · "CONTIENE" (`like '%kind%'`) en lugar de prefijo, para pillar nombres como
--     "1º Infantil", "Infantil A", "Cadete masculino", etc.
--   · prebenjamin se evalúa ANTES que benjamin (el CASE para en la 1ª coincidencia)
--     para que "prebenjamin" no caiga en la rama de "benjamin".
--
-- SOLO toca filas donde el valor derivado del kind difiera del actual. Las
-- categorías cuyo nombre NO mapea a ningún kind conocido (new_val null) NO se tocan
-- (se respeta una duración personalizada puesta a mano).
--
-- La robustez para categorías NUEVAS (derivar la duración al crear/renombrar) es del
-- Rework A; aquí solo corregimos el dato existente.

do $$
declare
  c record;
  norm text;
  new_val integer;
begin
  for c in select id, name, half_duration_minutes from public.categories loop
    norm := lower(unaccent(c.name));
    new_val := case
      when norm like '%querubin%'    then 15
      when norm like '%prebenjamin%' then 20   -- antes que benjamin (solape)
      when norm like '%benjamin%'    then 25
      when norm like '%alevin%'      then 30
      when norm like '%infantil%'    then 35
      when norm like '%cadete%'      then 40
      when norm like '%juvenil%'     then 45
      when norm like '%amateur%'     then 45
      when norm like '%senior%'      then 45
      when norm like '%veterano%'    then 45
      else null
    end;
    if new_val is not null and c.half_duration_minutes is distinct from new_val then
      update public.categories
         set half_duration_minutes = new_val
       where id = c.id;
      raise notice 'categoria % ("%"): % -> %', c.id, c.name, c.half_duration_minutes, new_val;
    end if;
  end loop;
end $$;
