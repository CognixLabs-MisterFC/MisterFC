-- ════════════════════════════════════════════════════════════════════════════
-- RÉGIMEN DE CAMBIOS · las filas de SENIOR y la corrección de JUVENIL/TERCERA.
--
-- ── LA REGLA, confirmada por Jose ───────────────────────────────────────────
--   SIN LÍMITE y con reentrada:
--     · cadete primera y segunda
--     · infantil primera y segunda
--     · alevín, benjamín, prebenjamín y querubín — TODAS sus divisiones
--   7 CAMBIOS y sin reentrada:
--     · todo lo demás, juvenil y senior incluidos
--
-- ── QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO ────────────────────────────────────
-- El catálogo tenía 22 filas y siete `category_kind`. Contrastadas una a una con
-- la regla: 21 correctas, UNA mal, y ninguna que sobre.
--
--   · MAL: `juvenil / tercera` estaba como `rolling` (ilimitado + reentrada) y la
--     regla dice 7 sin reentrada. Era la única división de juvenil que se salía.
--   · AUSENTE: `senior` no tenía NI UNA fila — ni `amateur` ni `veterano`.
--
-- Y eso último no fallaba, que es lo peor: `DEFAULT_REGIME` en
-- `packages/core/src/match/regime.ts` es `ROLLING_REGIME`, así que un equipo sin
-- fila en el catálogo juega con cambios ILIMITADOS y reentrada EN SILENCIO. Para
-- un senior de tercera eso es exactamente la regla contraria a la real, sin un
-- error, sin un aviso y sin forma de notarlo desde la pantalla.
--
-- Además, con cero filas para `senior` el alta de equipo ni siquiera deja elegir:
-- el selector de división solo se pinta si el `kind` tiene divisiones en este
-- catálogo (`divisions.length > 0` en `equipos/team-dialog.tsx`), y la server
-- action rechaza el par con `isDivisionValid`. O sea que hoy un Senior A no puede
-- nacer con división NI a mano.
--
-- ── A QUIÉN AFECTA HOY: A NADIE ────────────────────────────────────────────
-- Medido en producción antes de tocar: CERO equipos de `juvenil`, `senior`,
-- `amateur` o `veterano`, y CERO equipos con `division = 'tercera'`. Así que
-- corregir juvenil/tercera no cambia el comportamiento de ningún partido ya
-- jugado ni de ningún equipo existente. Esta migración es de datos de
-- referencia y llega antes que los equipos, no después.
--
-- ── POR QUÉ SENIOR LLEVA ESTAS SEIS DIVISIONES ─────────────────────────────
-- Porque bajo la regla de Jose TODAS las divisiones de senior son el MISMO
-- régimen (7 sin reentrada), el juego de divisiones NO cambia ningún
-- comportamiento: solo decide qué opciones ofrece el desplegable del alta de
-- equipo. Así que se copia el vocabulario de `juvenil` —que es la categoría
-- vecina y ya está completa— con lo que `tercera` queda dentro, que es lo que
-- hacía falta. Sobrar una opción que nadie elige no rompe nada; faltar la que se
-- necesita obliga a otra migración.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ─────────────────────────────
-- `amateur` y `veterano` siguen SIN filas. La regla de Jose ("todo lo demás")
-- también las cubriría, pero su vocabulario de divisiones no está decidido y
-- unos datos de referencia inventados son peores que un hueco conocido. El hueco
-- se cierra bien en el código, no aquí: poniendo `DEFAULT_REGIME` en 7 sin
-- reentrada, para que la ausencia de fila falle del lado SEGURO en vez del
-- permisivo. Va en su propio PR, porque las migraciones viajan solas.
--
-- Sin cambios de esquema: ni columnas, ni constraints, ni policies. La RLS y la
-- policy de lectura de `substitution_regimes` se quedan como están; las filas
-- nuevas las hereda.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Corrección: juvenil / tercera → 7 cambios, sin reentrada.
--
--    Las TRES columnas van en el mismo UPDATE y no es estilo: el CHECK
--    `substitution_regimes_shape` exige que `regime_type`, `max_subs` y
--    `allow_reentry` sean coherentes entre sí. Cambiar solo `regime_type`
--    violaría la restricción y la migración moriría aquí.
-- ─────────────────────────────────────────────────────────────────────────────
update public.substitution_regimes
   set regime_type   = 'limited',
       max_subs      = 7,
       allow_reentry = false
 where category_kind = 'juvenil'
   and division      = 'tercera';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Alta: las divisiones de `senior`, todas con el mismo régimen.
--
--    `ordinal` conserva la convención del seed original: menor = división más
--    alta (honor 1 … tercera 6), que es el orden en que las ofrece el selector.
--
--    `on conflict do update` y no un INSERT a secas: hace la migración
--    idempotente y, si alguien hubiera metido a mano una fila de senior con el
--    régimen equivocado, la deja en el bueno en vez de fallar.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.substitution_regimes
  (category_kind, division, ordinal, regime_type, max_subs, allow_reentry) values
  ('senior', 'honor',      1, 'limited', 7, false),
  ('senior', 'autonomica', 2, 'limited', 7, false),
  ('senior', 'preferente', 3, 'limited', 7, false),
  ('senior', 'primera',    4, 'limited', 7, false),
  ('senior', 'segunda',    5, 'limited', 7, false),
  ('senior', 'tercera',    6, 'limited', 7, false)
on conflict (category_kind, division) do update
   set ordinal       = excluded.ordinal,
       regime_type   = excluded.regime_type,
       max_subs      = excluded.max_subs,
       allow_reentry = excluded.allow_reentry;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Guard: el catálogo ENTERO contra la regla, aquí y ahora.
--
--    No es el pgTAP repetido: esto corre al APLICAR. Si el catálogo de destino no
--    es el que se midió al escribir esta migración —porque alguien añadió filas
--    por otro camino—, la aplicación se para y lo dice, en vez de dejar un
--    catálogo a medias que nadie vuelve a mirar.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_malas text; v_senior int;
begin
  select string_agg(format('%s/%s=%s', category_kind, division, regime_type), ', '
                    order by category_kind, division)
    into v_malas
    from public.substitution_regimes sr
   where sr.regime_type <> case
           when sr.category_kind in ('querubin', 'prebenjamin', 'benjamin', 'alevin')
             then 'rolling'
           when sr.category_kind in ('cadete', 'infantil')
                and sr.division in ('primera', 'segunda')
             then 'rolling'
           else 'limited'
         end;

  if v_malas is not null then
    raise exception
      'substitution_regimes no cumple la regla confirmada (corrido solo en base y en cadete/infantil 1a-2a): %',
      v_malas;
  end if;

  select count(*) into v_senior
    from public.substitution_regimes where category_kind = 'senior';
  if v_senior = 0 then
    raise exception 'substitution_regimes se ha quedado sin filas de senior: el alta de equipo no ofreceria division y el regimen caeria al DEFAULT (corrido)';
  end if;

  if not exists (select 1 from public.substitution_regimes
                  where category_kind = 'senior' and division = 'tercera') then
    raise exception 'falta senior/tercera, que es la division del Senior A que motivo esta migracion';
  end if;
end $$;
