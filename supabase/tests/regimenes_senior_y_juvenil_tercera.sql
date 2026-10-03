-- RÉGIMEN DE CAMBIOS — las filas de SENIOR y la corrección de JUVENIL/TERCERA.
--
-- QUÉ SE PROTEGE, y por qué merece un test propio siendo "solo datos":
--
-- El régimen de cambios no se calcula: se LEE de `substitution_regimes`, que es la
-- fuente única. Y una fila mal puesta no rompe nada visible — deja que un partido se
-- juegue con la regla equivocada. Peor todavía es la fila que FALTA: `DEFAULT_REGIME`
-- en `packages/core/src/match/regime.ts` es `ROLLING_REGIME`, así que un `category_kind`
-- sin filas juega con cambios ILIMITADOS y reentrada, en silencio. Eso es lo que le
-- pasaba a `senior`.
--
-- LAS DOS ASERCIONES QUE MÁS VALEN:
--
--   [3] EL CAREO: el catálogo ENTERO, fila por fila, contra la regla confirmada por
--       Jose. No comprueba las filas que esta migración toca, comprueba TODAS — así
--       que también caza la siguiente que alguien añada mal.
--   [6] CONTROL NEGATIVO: el CHECK `substitution_regimes_shape` sigue rechazando una
--       fila incoherente. Sin esto, [1] y [2] podrían estar pasando sobre una tabla
--       que ya admite cualquier cosa.
--
-- Cubre:
--   [0] La tabla intacta: RLS activada y su policy de lectura, sin cambios de esquema.
--   [1] `senior`: seis divisiones, todas 7 sin reentrada, y `tercera` entre ellas.
--   [2] `juvenil / tercera` corregida: ya NO es corrido.
--   [3] EL CAREO: las 28 filas contra la regla.
--   [4] Recuento por `kind` y total.
--   [5] Lo que lee la APP: `authenticated` ve las filas nuevas (si no, el selector del
--       alta de equipo seguiría vacío aunque los datos estén).
--   [6] CONTROL NEGATIVO: el CHECK de coherencia sigue puesto.
--
-- LÍMITE DE ALCANCE, dicho a propósito: el COMPORTAMIENTO (contar cambios, permitir o
-- no la reentrada) vive en TypeScript —`canRegisterSubstitution`, `deriveSquad`— y lo
-- cubren sus propios tests. Aquí se prueba el DATO, que es lo que esta migración mueve.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- [0] La tabla intacta. Esta migración es de datos: no toca esquema ni permisos.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  if not exists (select 1 from pg_class
                  where oid = 'public.substitution_regimes'::regclass and relrowsecurity) then
    raise exception 'FAIL [0]: substitution_regimes sin RLS activada';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'substitution_regimes';
  if v_n <> 1 then
    raise exception 'FAIL [0]: substitution_regimes tendria que tener UNA policy de lectura y tiene %', v_n;
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'substitution_regimes'
                    and cmd = 'SELECT' and 'authenticated' = any (roles)) then
    raise exception 'FAIL [0]: la policy de lectura para authenticated ha desaparecido: el selector de divisiones se quedaria vacio';
  end if;

  -- El CHECK de coherencia tiene que seguir existiendo (su efecto se prueba en [6]).
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.substitution_regimes'::regclass
                    and conname = 'substitution_regimes_shape') then
    raise exception 'FAIL [0]: falta el CHECK substitution_regimes_shape';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] `senior`: las seis divisiones, todas con el MISMO régimen, y `tercera` dentro.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int; v_malas text; v_divs text;
begin
  select count(*) into v_n
    from public.substitution_regimes where category_kind = 'senior';
  if v_n <> 6 then
    raise exception 'FAIL [1]: senior tendria que tener 6 divisiones y tiene %', v_n;
  end if;

  -- Todas limitadas a 7 y sin reentrada: la regla no distingue entre divisiones de
  -- senior, así que una sola fila distinta sería un error de dedo con consecuencias.
  select string_agg(format('%s(%s,%s,%s)', division, regime_type, coalesce(max_subs, -1), allow_reentry),
                    ', ' order by ordinal)
    into v_malas
    from public.substitution_regimes
   where category_kind = 'senior'
     and not (regime_type = 'limited' and max_subs = 7 and allow_reentry = false);
  if v_malas is not null then
    raise exception 'FAIL [1]: filas de senior que no son 7-sin-reentrada: %', v_malas;
  end if;

  -- `tercera` es la que motivó la migración: el Senior A de UDFonteta juega ahí.
  if not exists (select 1 from public.substitution_regimes
                  where category_kind = 'senior' and division = 'tercera') then
    select string_agg(division, ', ' order by ordinal) into v_divs
      from public.substitution_regimes where category_kind = 'senior';
    raise exception 'FAIL [1]: falta senior/tercera. Hay: %', coalesce(v_divs, '(ninguna)');
  end if;

  -- Los `ordinal` ordenan el desplegable: duplicarlos lo deja en orden arbitrario.
  select count(distinct ordinal) into v_n
    from public.substitution_regimes where category_kind = 'senior';
  if v_n <> 6 then
    raise exception 'FAIL [1]: los ordinal de senior no son 6 distintos (son %)', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] `juvenil / tercera`: era la única división de juvenil en corrido. Ya no.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select regime_type, max_subs, allow_reentry into r
    from public.substitution_regimes
   where category_kind = 'juvenil' and division = 'tercera';

  if r is null then
    raise exception 'FAIL [2]: ha desaparecido la fila juvenil/tercera. Habia que CORREGIRLA, no borrarla: sin ella el equipo cae al DEFAULT (corrido)';
  end if;
  if r.regime_type <> 'limited' or r.max_subs <> 7 or r.allow_reentry then
    raise exception 'FAIL [2]: juvenil/tercera sigue mal (tipo=%, tope=%, reentra=%)',
      r.regime_type, coalesce(r.max_subs, -1), r.allow_reentry;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] EL CAREO. El catálogo entero contra la regla confirmada:
--       corrido  = querubín, prebenjamín, benjamín, alevín (todas sus divisiones)
--                  + cadete e infantil en primera y segunda
--       limitado = todo lo demás, 7 cambios y sin reentrada
--     Comprueba TODAS las filas, no solo las que mueve esta migración.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_malas text; v_total int;
begin
  -- Ancla positiva primero: si la tabla estuviera vacía, la ausencia de filas malas
  -- de abajo sería verde y no afirmaría nada.
  select count(*) into v_total from public.substitution_regimes;
  if v_total < 20 then
    raise exception 'FAIL [3]: el catalogo tiene solo % filas; algo lo ha vaciado y el careo no probaria nada', v_total;
  end if;

  select string_agg(format('%s/%s: es %s(tope=%s,reentra=%s) y debia ser %s',
                           category_kind, division, regime_type,
                           coalesce(max_subs, -1), allow_reentry, esperado),
                    ' | ' order by category_kind, division)
    into v_malas
    from (
      select sr.*,
             case
               when sr.category_kind in ('querubin', 'prebenjamin', 'benjamin', 'alevin')
                 then 'rolling'
               when sr.category_kind in ('cadete', 'infantil')
                    and sr.division in ('primera', 'segunda')
                 then 'rolling'
               else 'limited'
             end as esperado
        from public.substitution_regimes sr
    ) x
   where x.regime_type <> x.esperado
      -- Y la forma completa, no solo el tipo: un `limited` con tope 5 cumpliria el
      -- tipo y seria otra regla distinta.
      or (x.esperado = 'limited' and (x.max_subs <> 7 or x.allow_reentry))
      or (x.esperado = 'rolling' and (x.max_subs is not null or not x.allow_reentry));

  if v_malas is not null then
    raise exception 'FAIL [3]: el catalogo no cumple la regla: %', v_malas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Recuento. 22 filas había + 6 de senior = 28, y ocho `kind`.
--     Si alguien añade `amateur` o `veterano` (que hoy NO están, a propósito), este
--     bloque salta y obliga a decidir su régimen en vez de heredar el DEFAULT.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_total int; v_kinds int;
begin
  select count(*), count(distinct category_kind) into v_total, v_kinds
    from public.substitution_regimes;

  if v_total <> 28 then
    raise exception 'FAIL [4]: el catalogo tendria que tener 28 filas y tiene %. Si es una categoria nueva, decide su regimen y actualiza este recuento', v_total;
  end if;
  if v_kinds <> 8 then
    raise exception 'FAIL [4]: tendria que haber 8 category_kind y hay %', v_kinds;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] LO QUE LEE LA APP. El selector del alta de equipo lee esta tabla como
--     `authenticated`: si la policy no deja ver las filas de senior, los datos
--     estarían bien y la pantalla seguiría sin ofrecer división.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.substitution_regimes where category_kind = 'senior';
  if v_n <> 6 then
    raise exception 'FAIL [5]: authenticated ve % divisiones de senior en vez de 6: el selector del alta se quedaria corto', v_n;
  end if;
end $$;

reset role;

-- El reset de verdad: si no hubiera vuelto a postgres, los bloques siguientes
-- medirían con el rol equivocado y darían verdes que no valen.
do $$
begin
  if current_user = 'authenticated' then
    raise exception 'FAIL [5]: la sesion se ha quedado como authenticated';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] CONTROL NEGATIVO. El CHECK de coherencia sigue rechazando lo incoherente.
--     Sin esta prueba, todo lo de arriba podría estar pasando sobre una tabla que
--     ya admite un `limited` sin tope o un `rolling` con reentrada apagada.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_paso boolean;
begin
  -- a · `limited` sin tope: la forma prohibida.
  v_paso := false;
  begin
    insert into public.substitution_regimes
      (category_kind, division, ordinal, regime_type, max_subs, allow_reentry)
      values ('senior', '__probe_a__', 99, 'limited', null, false);
    v_paso := true;
  exception when others then
    null;  -- lo esperado
  end;
  if v_paso then
    raise exception 'FAIL [6a]: la tabla ha aceptado un limited SIN tope';
  end if;

  -- b · `rolling` sin reentrada: la otra mitad del CHECK.
  v_paso := false;
  begin
    insert into public.substitution_regimes
      (category_kind, division, ordinal, regime_type, max_subs, allow_reentry)
      values ('senior', '__probe_b__', 98, 'rolling', null, false);
    v_paso := true;
  exception when others then
    null;
  end;
  if v_paso then
    raise exception 'FAIL [6b]: la tabla ha aceptado un rolling SIN reentrada';
  end if;

  -- c · ANCLA POSITIVA del control: una fila BIEN formada sí entra. Sin esto, [6a] y
  --     [6b] pasarían igual si los INSERT fallaran por cualquier otro motivo.
  insert into public.substitution_regimes
    (category_kind, division, ordinal, regime_type, max_subs, allow_reentry)
    values ('senior', '__probe_c__', 97, 'limited', 7, false);
  if not exists (select 1 from public.substitution_regimes
                  where category_kind = 'senior' and division = '__probe_c__') then
    raise exception 'FAIL [6c]: no ha entrado una fila bien formada; [6a] y [6b] no prueban el CHECK';
  end if;
  delete from public.substitution_regimes
   where category_kind = 'senior' and division = '__probe_c__';
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Regímenes: senior (6 divisiones, 7 sin reentrada) + juvenil/tercera corregida.'
\echo '   El careo [3] valida las 28 filas contra la regla, no solo las tocadas.'
\echo '──────────────────────────────────────────────'
