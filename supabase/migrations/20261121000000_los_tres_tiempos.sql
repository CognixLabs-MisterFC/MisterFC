-- LOS TRES TIEMPOS — capa de base de datos.
--
-- Por qué: el equipo de Querubines (fútbol 5, migración 20261120000000) juega
-- TRES TIEMPOS DE DOCE MINUTOS, no dos partes. Hoy un partido tiene dos partes
-- porque la lista de periodos tiene dos, y «cuántos periodos» no existe como
-- concepto en ninguna parte del modelo.
--
-- ── LO QUE LLEVA ─────────────────────────────────────────────────────────────
--   1. `third_period` en el enum de `match_periods.period`.
--   2. `third_period` en el enum de `match_events.period`. Son dos CHECK con la
--      MISMA lista en dos tablas: un gol del tercer tiempo se guarda en la
--      segunda, así que ampliar solo la primera dejaría el reloj con tres
--      periodos y los goles sin poder apuntarse en el tercero.
--   3. `categories.period_count`: cuántos periodos regulares tiene un partido de
--      esa categoría. Por defecto DOS, que es lo que hay hoy en todas.
--
-- ── POR QUÉ `third_period` Y NO RENOMBRAR TODO A period_1/2/3 ────────────────
-- Renombrar sería más bonito y mucho peor: hay 22 filas en producción con
-- `first_half`/`second_half`/`extra_first`/`extra_second`, más la app nativa
-- publicada, que seguiría escribiendo los nombres viejos. Habría una ventana en
-- la que el móvil de un entrenador manda `first_half` y el CHECK nuevo lo
-- rechaza, o al revés. Esto es ADITIVO: ni una fila cambia, ni un cliente viejo
-- se rompe. Las dos primeras conservan su nombre histórico aunque en un partido
-- de tres tiempos no sean «mitades»: el nombre es un identificador, no una
-- descripción.
--
-- ── POR QUÉ EL CHECK DE period_count ES (2,3) Y NO 1..9 ──────────────────────
-- Porque el reloj solo va a saber colocar un tercero (eso es el paso siguiente,
-- en código). Un CHECK más ancho que el código permite guardar un estado que la
-- app no sabe pintar, y entonces el hueco no se ve hasta que alguien abre el
-- directo de ese partido. Ampliarlo cuando haga falta es una línea.
--
-- ── `half_duration_minutes` NO SE RENOMBRA ───────────────────────────────────
-- Su nombre dice «mitad» pero su significado ya era «duración nominal de CADA
-- periodo regular»: así la usa `matchPhase` para el offset del marcador y para
-- el añadido. Tres tiempos de doce = `period_count = 3` y
-- `half_duration_minutes = 12`. Renombrarla tocaría 22 ficheros y los tipos
-- generados a cambio de nada medible, así que se documenta y se queda.
--
-- ── LO QUE NO LLEVA ──────────────────────────────────────────────────────────
--   · El código: `PERIOD_ORDER` deja de ser una constante global y pasa a
--     depender de la categoría, `footballBaseMinutes` deja de ser un `switch` y
--     pasa a sumar los periodos previos, y las etiquetas de la UI (web, nativa y
--     tres idiomas). Va en su PR. Hasta que entre, esta migración no cambia NADA
--     de lo que se ve: con `period_count` a 2 en todas las categorías, el reloj
--     hace exactamente lo de siempre.
--   · El dato: poner la categoría «Querubín» de UDFonteta en 3 periodos de 12
--     minutos es una escritura de datos de un club, no una migración genérica.
--     Va con el alta del equipo. Mientras no se haga, un amistoso de Querubines
--     seguirá ofreciendo dos partes.
--
-- Deliberadamente NO se toca ninguna fila: `default 2` deja a todos los clubes
-- exactamente como estaban. Una migración que cambia el comportamiento de un
-- partido de otro club sin que nadie lo haya pedido es una migración que no se
-- puede aplicar un martes por la tarde.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El reloj admite un tercer periodo regular.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.match_periods
  drop constraint if exists match_periods_period_check;

alter table public.match_periods
  add constraint match_periods_period_check
  check (period = any (array[
    'first_half'::text,
    'second_half'::text,
    'third_period'::text,
    'extra_first'::text,
    'extra_second'::text,
    'penalties'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Y los sucesos del partido también: un gol del tercer tiempo se apunta aquí.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.match_events
  drop constraint if exists match_events_period_check;

alter table public.match_events
  add constraint match_events_period_check
  check (period = any (array[
    'first_half'::text,
    'second_half'::text,
    'third_period'::text,
    'extra_first'::text,
    'extra_second'::text,
    'penalties'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cuántos periodos regulares juega una categoría. Dos, salvo que se diga.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.categories
  add column if not exists period_count smallint not null default 2;

alter table public.categories
  drop constraint if exists categories_period_count_check;

alter table public.categories
  add constraint categories_period_count_check
  check (period_count in (2, 3));

comment on column public.categories.period_count is
  'Nº de periodos REGULARES de un partido de esta categoría: 2 (dos partes, lo normal) o 3 (tres tiempos, querubines). La duración de CADA periodo es half_duration_minutes. El CHECK se queda en (2,3) a propósito: es lo que el reloj sabe colocar.';

comment on column public.categories.half_duration_minutes is
  'Duración nominal de CADA periodo regular, en minutos — no «de la mitad del partido», aunque el nombre venga de cuando solo había dos. Con period_count=3 y 12 aquí, son tres tiempos de doce. La usa matchPhase para el offset del marcador y para el añadido.';
