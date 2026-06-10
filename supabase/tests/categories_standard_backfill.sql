-- Rework C · C1 EXPAND — verifica seed_standard_categories (sembrado idempotente).
-- Migración 20260702000000_rework_c1_categories_standard_expand.sql.
--
-- Convención del repo: psql ON_ERROR_STOP=1; asserts con DO + raise exception;
-- todo en BEGIN/ROLLBACK → no deja rastro.
--
-- Casos:
--   N1. Club NUEVO (sin categorías) → siembra las 10 estándar, is_standard=true,
--       con kind y half_duration canónicos.
--   I1. Re-ejecutar en el mismo club → idempotente: sigue habiendo 10 (no duplica).
--   C1. Club VIEJO con custom (kind null) + una de kind 'infantil' + una llamada
--       'Cadete': la custom queda intacta (is_standard=false); NO se siembra
--       infantil ni cadete (solape por kind/nombre); el resto de estándar sí.
--   H1. half_duration canónico en las estándar insertadas (infantil=35, querubin=15).

begin;

-- ── N1. Club nuevo → 10 estándar ─────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000001', 'Club C1 Nuevo', 'club-c1-nuevo');

select public.seed_standard_categories('c1000000-0000-4000-8000-000000000001');

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000001' and is_standard;
  if v_count <> 10 then
    raise exception 'FAIL [N1]: club nuevo debería tener 10 estándar, tiene %', v_count;
  end if;

  -- Todas las del catálogo presentes con kind canónico.
  select count(*) into v_count from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000001'
     and kind in ('querubin','prebenjamin','benjamin','alevin','infantil',
                  'cadete','juvenil','amateur','senior','veterano');
  if v_count <> 10 then
    raise exception 'FAIL [N1]: faltan kinds canónicos, hay %', v_count;
  end if;
end $$;

-- ── H1. half_duration canónico ───────────────────────────────────────────────
do $$
declare v_inf integer; v_que integer;
begin
  select half_duration_minutes into v_inf from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000001' and kind = 'infantil';
  select half_duration_minutes into v_que from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000001' and kind = 'querubin';
  if v_inf <> 35 then raise exception 'FAIL [H1]: infantil half_duration debería ser 35, es %', v_inf; end if;
  if v_que <> 15 then raise exception 'FAIL [H1]: querubin half_duration debería ser 15, es %', v_que; end if;
end $$;

-- ── I1. Idempotencia: re-ejecutar no duplica ─────────────────────────────────
select public.seed_standard_categories('c1000000-0000-4000-8000-000000000001');
select public.seed_standard_categories('c1000000-0000-4000-8000-000000000001');

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000001';
  if v_count <> 10 then
    raise exception 'FAIL [I1]: re-run no debe duplicar; esperaba 10, hay %', v_count;
  end if;
end $$;

-- ── C1. Club viejo con custom + solapes por kind/nombre ──────────────────────
insert into public.clubs (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000002', 'Club C1 Viejo', 'club-c1-viejo');

-- custom sin kind, una de kind infantil (nombre distinto), y una llamada 'Cadete'.
insert into public.categories (club_id, name, kind, half_duration_minutes, is_standard) values
  ('c1000000-0000-4000-8000-000000000002', 'Escuela',     null,      30, false),
  ('c1000000-0000-4000-8000-000000000002', 'Infantil A',  'infantil', 35, false),
  ('c1000000-0000-4000-8000-000000000002', 'Cadete',       null,      40, false);

select public.seed_standard_categories('c1000000-0000-4000-8000-000000000002');

do $$
declare v_custom integer; v_std integer; v_inf_std integer; v_cad_std integer;
begin
  -- Las 3 custom intactas (is_standard sigue false).
  select count(*) into v_custom from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000002' and not is_standard;
  if v_custom <> 3 then
    raise exception 'FAIL [C1]: las 3 custom deberían quedar intactas (is_standard=false), hay %', v_custom;
  end if;

  -- infantil NO se siembra (kind ya presente en custom).
  select count(*) into v_inf_std from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000002' and kind = 'infantil' and is_standard;
  if v_inf_std <> 0 then
    raise exception 'FAIL [C1]: infantil no debe sembrarse (kind ya presente), estándar=%', v_inf_std;
  end if;

  -- 'Cadete' NO se siembra (nombre ya presente, evita unique(lower(name))).
  select count(*) into v_cad_std from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000002' and kind = 'cadete' and is_standard;
  if v_cad_std <> 0 then
    raise exception 'FAIL [C1]: cadete no debe sembrarse (nombre ya presente), estándar=%', v_cad_std;
  end if;

  -- El resto (10 - infantil - cadete = 8) sí se siembran como estándar.
  select count(*) into v_std from public.categories
   where club_id = 'c1000000-0000-4000-8000-000000000002' and is_standard;
  if v_std <> 8 then
    raise exception 'FAIL [C1]: deberían sembrarse 8 estándar (10 menos infantil y cadete), hay %', v_std;
  end if;
end $$;

rollback;
