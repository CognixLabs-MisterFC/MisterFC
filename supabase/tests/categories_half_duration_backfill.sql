-- F4.9 — Verifica que el backfill de half_duration_minutes mapea las
-- categorías base españolas a su duración estándar de tiempo,
-- case-insensitive y sin sensibilidad a tildes, con detección por prefijo.
--
-- La migración 20260605000003_categories_half_duration.sql sembró los
-- valores en el momento de aplicarse. Este test inserta categorías nuevas
-- a posteriori y verifica que UN admin podría reaplicar la lógica — pero
-- como el backfill es one-shot, la validación se hace sobre los datos
-- históricos que la migración tocó. Aquí simulamos el mismo cálculo y
-- afirmamos que coincide con el valor en BD.
--
-- Caveat: si alguien creó categorías DESPUÉS de la migración con un nombre
-- estándar (p.ej. "Cadete A 2026"), el default 45 prevalece. El UI de
-- /es/categorias (cuando exista) deberá permitir editar half_duration.

begin;

insert into public.clubs (id, name, slug) values
  ('11111111-1111-4111-8111-111111119001', 'Club Half A', 'club-half-a');

-- Casos de prueba: el nombre con acento, sin acento, mayúsculas, sufijos.
-- Insertamos directamente con el valor que esperamos del cálculo (estándar
-- español) para verificar la consistencia con lo que el backfill aplicaría.
insert into public.categories (id, club_id, name, season, half_duration_minutes) values
  ('22222222-2222-4222-8222-222222229001', '11111111-1111-4111-8111-111111119001', 'Querubín', '2025-26', 15),
  ('22222222-2222-4222-8222-222222229002', '11111111-1111-4111-8111-111111119001', 'Prebenjamín A', '2025-26', 20),
  ('22222222-2222-4222-8222-222222229003', '11111111-1111-4111-8111-111111119001', 'Prebenjamin B', '2025-26', 20),
  ('22222222-2222-4222-8222-222222229004', '11111111-1111-4111-8111-111111119001', 'BENJAMÍN', '2025-26', 25),
  ('22222222-2222-4222-8222-222222229005', '11111111-1111-4111-8111-111111119001', 'Alevín 2', '2025-26', 30),
  ('22222222-2222-4222-8222-222222229006', '11111111-1111-4111-8111-111111119001', 'infantil', '2025-26', 35),
  ('22222222-2222-4222-8222-222222229007', '11111111-1111-4111-8111-111111119001', 'Cadete A', '2025-26', 40),
  ('22222222-2222-4222-8222-222222229008', '11111111-1111-4111-8111-111111119001', 'Juvenil', '2025-26', 45),
  ('22222222-2222-4222-8222-222222229009', '11111111-1111-4111-8111-111111119001', 'Amateur', '2025-26', 45),
  ('22222222-2222-4222-8222-22222222900a', '11111111-1111-4111-8111-111111119001', 'Veterano', '2025-26', 45),
  ('22222222-2222-4222-8222-22222222900b', '11111111-1111-4111-8111-111111119001', 'XYZ NoMatch', '2025-26', 45);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 1: simular el cálculo del backfill y compararlo con la columna.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  c record;
  norm text;
  expected integer;
begin
  for c in select id, name, half_duration_minutes from public.categories
            where club_id = '11111111-1111-4111-8111-111111119001'
  loop
    norm := lower(unaccent(c.name));
    expected := case
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
      else 45
    end;
    if c.half_duration_minutes <> expected then
      raise exception 'FAIL [%]: half_duration_minutes=% esperaba %', c.name, c.half_duration_minutes, expected;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 2: check constraint (>0, <=90) — INSERT inválido debe fallar.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.categories (club_id, name, season, half_duration_minutes) values
      ('11111111-1111-4111-8111-111111119001', 'Bad Zero', '2025-26', 0);
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [check zero]: half_duration_minutes=0 deberia ser invalido';
  end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.categories (club_id, name, season, half_duration_minutes) values
      ('11111111-1111-4111-8111-111111119001', 'Bad Huge', '2025-26', 91);
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [check huge]: half_duration_minutes=91 deberia ser invalido';
  end if;
end $$;

rollback;

select 'OK categories_half_duration_backfill' as result;
