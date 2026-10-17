/**
 * F7.7 — Motor del reloj del partido (PURO, sin DOM ni red).
 *
 * Spec 7.0 §3.2 / §6: el cronómetro vive en BD (tabla `match_periods`), no solo
 * en memoria del cliente, para sobrevivir a recargas. Una fila por periodo
 * jugado. El reloj ABSOLUTO de un instante es:
 *
 *   clock_seconds = base_offset_seconds
 *                 + accumulated_seconds
 *                 + (running ? floor((now - last_started_at) / 1000) : 0)
 *
 * `base_offset_seconds` = el segundo absoluto en el que arranca el marcador de
 * ese periodo (0 en la 1ª parte; tras el descanso, el juego acumulado hasta
 * entonces). Así el reloj es monótono no decreciente y el descanso NO cuenta.
 *
 * Este módulo es la base limpia del cálculo de minutos jugados (7.8) y de la
 * consolidación de stats (7.10): toda la aritmética del tiempo vive aquí y se
 * testea sin DOM (§15).
 */

/** Periodos jugables (coincide con el CHECK de match_periods/match_events). */
export type PeriodKind =
  | 'first_half'
  | 'second_half'
  | 'third_period'
  | 'extra_first'
  | 'extra_second'
  | 'penalties';

/**
 * TODOS los valores válidos de `period`, sin orden de juego. Para validar lo que
 * llega de fuera (el enum de zod) y nada más: el ORDEN depende de la categoría.
 */
export const PERIOD_KINDS: readonly PeriodKind[] = [
  'first_half',
  'second_half',
  'third_period',
  'extra_first',
  'extra_second',
  'penalties',
] as const;

/**
 * Cuántos periodos REGULARES juega una categoría: dos partes, o TRES TIEMPOS
 * (querubines). Es `categories.period_count`, y el CHECK de la base lo tiene
 * topado en (2,3) justo porque esto es lo que el reloj sabe colocar.
 */
export type PeriodCount = 2 | 3;

/**
 * Lo que venga de la base (un smallint) traído al dominio del reloj.
 *
 * Un valor desconocido —o un null de un join que no trajo la categoría— cae en
 * DOS, que es el comportamiento de siempre: ante la duda, el partido que ya
 * sabíamos contar. El que impide un 4 es el CHECK de la base, no esto.
 */
export function asPeriodCount(n: number | null | undefined): PeriodCount {
  return n === 3 ? 3 : 2;
}

/**
 * Periodos REGULARES (los que siempre se juegan) de una categoría. La duración
 * de cada uno sale de `categories.half_duration_minutes`.
 */
export function regularPeriods(count: PeriodCount): readonly PeriodKind[] {
  return count === 3
    ? (['first_half', 'second_half', 'third_period'] as const)
    : (['first_half', 'second_half'] as const);
}

/**
 * Orden de juego de los periodos PARA ESA CATEGORÍA. El índice + 1 es el
 * `ordinal` con el que se persiste cada fila (unique por evento), así que el
 * reloj absoluto sigue siendo monótono.
 *
 * ── POR QUÉ ESTO YA NO ES UNA CONSTANTE ─────────────────────────────────────
 * Antes era `PERIOD_ORDER`, una constante global de cinco elementos, y por eso
 * un partido tenía dos partes: no porque nadie lo hubiera decidido, sino porque
 * la LISTA tenía dos. Con tres tiempos el orden cambia —y con él los ordinales
 * de la prórroga, que pasan de 3 y 4 a 4 y 5—, de modo que no hay una respuesta
 * única: depende de la categoría. La constante se ha retirado a propósito para
 * que ningún sitio pueda seguir asumiendo la de dos sin decirlo.
 */
export function periodOrder(count: PeriodCount): readonly PeriodKind[] {
  return [...regularPeriods(count), ...EXTRA_PERIODS, 'penalties'];
}

/**
 * Los periodos de un acta RECONSTRUIDA: un partido que nunca se abrió en el directo
 * y se carga después, con el acta delante. Todos TERMINADOS y con la duración
 * completa, de modo que el reloj total sea `count · halfSeconds` y cada minuto caiga
 * en su periodo (`periodAtClock`).
 *
 * ── POR QUÉ ESTA FUNCIÓN EXISTE ─────────────────────────────────────────────
 * Porque el sitio que lo hacía escribía DOS filas a mano, `first_half` y
 * `second_half`, sin leer `categories.period_count`. En una categoría de tres tiempos
 * —querubín— eso sembraba 2 de 3: el reloj total quedaba en 2·12 en vez de 3·12, los
 * minutos jugados salían cortos, y un evento del tercer tiempo se guardaba como
 * `second_half`, porque `periodAtClock` se queda con el último periodo que cabe.
 *
 * Es exactamente lo que la cabecera de `periodOrder` dice que pasa cuando un sitio
 * asume la lista de dos sin decirlo: la constante global se retiró para que nadie
 * pudiera hacerlo, pero ahí estaba escrita a mano, donde ninguna retirada la alcanza.
 * Ahora el `count` es un ARGUMENTO OBLIGATORIO: no se puede sembrar sin decidirlo.
 */
export function reconstructedPeriods(count: PeriodCount, halfSeconds: number): ClockPeriod[] {
  const dur = Math.max(0, Math.floor(halfSeconds));
  return regularPeriods(count).map((period, i) => ({
    period,
    ordinal: i + 1,
    baseOffsetSeconds: i * dur,
    accumulatedSeconds: dur,
    running: false,
    lastStartedAt: null,
    ended: true,
  }));
}

/**
 * Sufijo de la clave de i18n con la que se rotula un periodo (o una fase, que
 * comparte estos nombres).
 *
 * ── POR QUÉ NO VALE USAR LA CLAVE TAL CUAL ──────────────────────────────────
 * En un partido de dos, los dos primeros periodos son «1ª parte» y «2ª parte».
 * En uno de TRES no son partes de nada: son «1er tiempo», «2º tiempo» y «3er
 * tiempo». Rotular un partido de querubines con «1ª parte» sería escribirle a
 * las familias algo que no existe, y es justo el sitio donde se nota: la
 * pantalla del directo.
 *
 * Los nombres de la base no cambian (ver la migración 20261121000000: son
 * identificadores, no descripciones); lo que cambia es cómo se LEEN.
 */
export function periodLabelKey(clave: string, count: PeriodCount): string {
  if (count !== 3) return clave;
  if (clave === 'first_half') return 'first_of_three';
  if (clave === 'second_half') return 'second_of_three';
  return clave;
}

/**
 * Proyección de una fila de `match_periods` relevante para el reloj (camelCase,
 * agnóstica de BD). `lastStartedAt` es ISO-8601 o null.
 */
export interface ClockPeriod {
  period: PeriodKind;
  ordinal: number;
  baseOffsetSeconds: number;
  accumulatedSeconds: number;
  running: boolean;
  lastStartedAt: string | null;
  ended: boolean;
}

/**
 * Parche a aplicar sobre una fila de `match_periods` (camelCase). El server
 * action lo traduce a snake_case antes de tocar la BD. Solo campos presentes
 * se actualizan.
 */
export interface ClockMutation {
  baseOffsetSeconds?: number;
  accumulatedSeconds?: number;
  running?: boolean;
  lastStartedAt?: string | null;
  ended?: boolean;
}

/** Fila completa para insertar un periodo nuevo (camelCase). */
export interface NewPeriod {
  period: PeriodKind;
  ordinal: number;
  baseOffsetSeconds: number;
  accumulatedSeconds: number;
  running: boolean;
  lastStartedAt: string | null;
  ended: boolean;
}

/** Segundos que el cronómetro lleva corriendo desde `lastStartedAt` hasta `nowMs`. */
function runningElapsedSeconds(period: ClockPeriod, nowMs: number): number {
  if (!period.running || period.lastStartedAt == null) return 0;
  const startedMs = Date.parse(period.lastStartedAt);
  if (Number.isNaN(startedMs)) return 0;
  // El reloj nunca retrocede aunque el wall-clock del cliente vaya atrasado.
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

/**
 * Reloj absoluto (en segundos) de UN periodo en el instante `nowMs`:
 * base_offset + accumulated + (running ? now - last_started : 0).
 */
export function periodClockSeconds(period: ClockPeriod, nowMs: number): number {
  return (
    period.baseOffsetSeconds + period.accumulatedSeconds + runningElapsedSeconds(period, nowMs)
  );
}

/**
 * Reloj absoluto del PARTIDO en el instante `nowMs` (§3.2). Es el máximo reloj
 * sobre todos los periodos: como `base_offset` es monótono por construcción, el
 * periodo activo (corriendo o el último jugado) siempre da el valor mayor.
 * Independiente del orden del array. Sin periodos → 0.
 */
export function clockSecondsAt(periods: readonly ClockPeriod[], nowMs: number): number {
  let max = 0;
  for (const p of periods) {
    const c = periodClockSeconds(p, nowMs);
    if (c > max) max = c;
  }
  return max;
}

/**
 * Periodo "actual" para mostrar/etiquetar y asignar a un evento que ocurre
 * ahora: el que corre; si ninguno corre, el de mayor `ordinal` que ya empezó
 * (acumuló juego, terminó o corre); si nada empezó, el de menor ordinal. null
 * si no hay periodos.
 */
export function currentPeriod(periods: readonly ClockPeriod[]): ClockPeriod | null {
  if (periods.length === 0) return null;
  const running = periods.find((p) => p.running);
  if (running) return running;

  const started = periods.filter(
    (p) => p.ended || p.accumulatedSeconds > 0 || p.baseOffsetSeconds > 0,
  );
  const pool = started.length > 0 ? started : periods;
  return pool.reduce((best, p) => (p.ordinal > best.ordinal ? p : best));
}

/** ¿El cronómetro corre ahora mismo? (algún periodo running). */
export function isClockRunning(periods: readonly ClockPeriod[]): boolean {
  return periods.some((p) => p.running);
}

/**
 * ¿Estamos en descanso? Hay al menos un periodo terminado, ninguno corre y
 * todavía queda algún periodo por jugar (no hemos agotado el catálogo). Si el
 * último periodo posible ya terminó, no es descanso: es fin de partido.
 */
export function isAtBreak(periods: readonly ClockPeriod[], count: PeriodCount): boolean {
  if (periods.length === 0) return false;
  if (isClockRunning(periods)) return false;
  const someEnded = periods.some((p) => p.ended);
  return someEnded && nextPeriodAfter(periods, count) !== null;
}

/**
 * Siguiente periodo a crear (el primero del orden que aún no existe) con su
 * `ordinal`. null si ya existen todos. No depende del estado de juego: solo de
 * qué periodos hay creados.
 */
export function nextPeriodAfter(
  periods: readonly ClockPeriod[],
  count: PeriodCount,
): { period: PeriodKind; ordinal: number } | null {
  const existing = new Set(periods.map((p) => p.period));
  const orden = periodOrder(count);
  for (let i = 0; i < orden.length; i++) {
    const period = orden[i];
    if (period && !existing.has(period)) {
      return { period, ordinal: i + 1 };
    }
  }
  return null;
}

/**
 * Periodos OPCIONALES de prórroga (F7.7b): solo si el operador la añade. La
 * tanda de penaltis (`penalties`) NO entra en este flujo (no es tiempo jugado);
 * queda en el catálogo del reloj pero no se ofrece como prórroga.
 */
export const EXTRA_PERIODS: readonly PeriodKind[] = ['extra_first', 'extra_second'] as const;

/**
 * ¿Es un periodo regular DE ESA CATEGORÍA? El tercer tiempo lo es solo cuando la
 * categoría juega tres: en una de dos partes, una fila `third_period` sería un
 * dato imposible y aquí no cuenta como reglamentario.
 */
export function isRegularPeriod(period: PeriodKind, count: PeriodCount): boolean {
  return (regularPeriods(count) as readonly string[]).includes(period);
}

export function isExtraPeriod(period: PeriodKind): boolean {
  return (EXTRA_PERIODS as readonly string[]).includes(period);
}

/**
 * Siguiente periodo REGULAR a crear (F7.7b): 1ª parte si no hay ninguno, 2ª parte
 * tras la 1ª; `null` una vez jugada la 2ª (el tiempo reglamentario está cubierto
 * → la acción principal pasa a "Finalizar partido", no a forzar prórroga).
 */
export function nextRegularPeriod(
  periods: readonly ClockPeriod[],
  count: PeriodCount,
): { period: PeriodKind; ordinal: number } | null {
  const next = nextPeriodAfter(periods, count);
  return next && isRegularPeriod(next.period, count) ? next : null;
}

/**
 * Siguiente periodo de PRÓRROGA a crear (F7.7b), si el operador decide añadirla:
 * 1ª prórroga tras la 2ª parte, 2ª prórroga tras la 1ª prórroga; `null` cuando ya
 * no hay más prórroga disponible (ni antes de acabar el tiempo reglamentario).
 */
export function nextExtraPeriod(
  periods: readonly ClockPeriod[],
  count: PeriodCount,
): { period: PeriodKind; ordinal: number } | null {
  const next = nextPeriodAfter(periods, count);
  return next && isExtraPeriod(next.period) ? next : null;
}

/**
 * ¿Se puede FINALIZAR el partido ya (F7.7b)? Sí cuando el tiempo reglamentario
 * está cubierto (la 2ª parte existe y terminó), el cronómetro no corre y no queda
 * ningún periodo a medias (todos los creados están terminados). Permite finalizar
 * tras la 2ª parte y tras cualquier prórroga, sin forzar la prórroga.
 */
export function canFinishMatch(periods: readonly ClockPeriod[], count: PeriodCount): boolean {
  if (isClockRunning(periods)) return false;
  // El tiempo reglamentario está cubierto cuando ha terminado el ÚLTIMO periodo
  // regular de la categoría: la 2ª parte en una de dos, el tercer tiempo en una
  // de tres. Antes esto buscaba 'second_half' a mano, lo que en un partido de
  // tres tiempos habría dejado finalizar con un tiempo entero por jugar.
  const regulares = regularPeriods(count);
  const ultimo = regulares[regulares.length - 1];
  const fila = periods.find((p) => p.period === ultimo);
  if (!fila || !fila.ended) return false;
  return periods.every((p) => p.ended);
}

/**
 * Construye el periodo siguiente, ARRANCÁNDOLO (running). Sirve tanto para
 * "Iniciar partido" (periods vacío → first_half) como para empezar 2ª parte o
 * prórroga. `baseOffset` = reloj absoluto actual (el periodo previo ya debe
 * estar en pausa/terminado). null si no quedan periodos.
 */
export function buildNextPeriod(
  periods: readonly ClockPeriod[],
  nowMs: number,
  nowIso: string,
  count: PeriodCount,
): NewPeriod | null {
  const next = nextPeriodAfter(periods, count);
  if (!next) return null;
  return {
    period: next.period,
    ordinal: next.ordinal,
    baseOffsetSeconds: clockSecondsAt(periods, nowMs),
    accumulatedSeconds: 0,
    running: true,
    lastStartedAt: nowIso,
    ended: false,
  };
}

/**
 * Pausar el periodo en curso: pliega el tiempo corrido en `accumulated` y para
 * el cronómetro. Idempotente si ya está en pausa.
 */
export function pauseClockPatch(period: ClockPeriod, nowMs: number): ClockMutation {
  if (!period.running) return {};
  return {
    accumulatedSeconds: period.accumulatedSeconds + runningElapsedSeconds(period, nowMs),
    running: false,
    lastStartedAt: null,
  };
}

/** Reanudar un periodo en pausa (no terminado): vuelve a correr desde ahora. */
export function resumeClockPatch(nowIso: string): ClockMutation {
  return { running: true, lastStartedAt: nowIso };
}

/**
 * Terminar el periodo en curso (fin de parte → descanso, o fin de partido):
 * pliega el tiempo corrido, para el cronómetro y marca `ended`.
 */
export function endPeriodPatch(period: ClockPeriod, nowMs: number): ClockMutation {
  return {
    accumulatedSeconds: period.accumulatedSeconds + runningElapsedSeconds(period, nowMs),
    running: false,
    lastStartedAt: null,
    ended: true,
  };
}

/**
 * Ajuste manual (§6): suma `deltaSeconds` (puede ser negativo) al reloj del
 * periodo actual. Si corre, pliega primero el tiempo corrido y re-ancla en
 * `nowIso` para no perder ni duplicar segundos. El reloj nunca baja de 0
 * (constraint accumulated >= 0).
 */
export function adjustClockPatch(
  period: ClockPeriod,
  deltaSeconds: number,
  nowMs: number,
  nowIso: string,
): ClockMutation {
  const folded = period.accumulatedSeconds + runningElapsedSeconds(period, nowMs);
  const nextAccumulated = Math.max(0, folded + deltaSeconds);
  if (period.running) {
    return { accumulatedSeconds: nextAccumulated, lastStartedAt: nowIso };
  }
  return { accumulatedSeconds: nextAccumulated };
}

/** "MM:SS" con minutos sin tope de 2 dígitos (un partido con prórroga supera 99'). */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Minuto de marcador (display_minute) a partir del reloj absoluto. */
export function displayMinute(totalSeconds: number): number {
  return Math.floor(Math.max(0, totalSeconds) / 60);
}
