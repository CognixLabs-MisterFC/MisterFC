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
  | 'extra_first'
  | 'extra_second'
  | 'penalties';

/**
 * Orden de juego de los periodos. El índice + 1 es el `ordinal` con el que se
 * persiste cada fila (unique por evento). Mantiene el reloj absoluto monótono.
 */
export const PERIOD_ORDER: readonly PeriodKind[] = [
  'first_half',
  'second_half',
  'extra_first',
  'extra_second',
  'penalties',
] as const;

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
    period.baseOffsetSeconds +
    period.accumulatedSeconds +
    runningElapsedSeconds(period, nowMs)
  );
}

/**
 * Reloj absoluto del PARTIDO en el instante `nowMs` (§3.2). Es el máximo reloj
 * sobre todos los periodos: como `base_offset` es monótono por construcción, el
 * periodo activo (corriendo o el último jugado) siempre da el valor mayor.
 * Independiente del orden del array. Sin periodos → 0.
 */
export function clockSecondsAt(
  periods: readonly ClockPeriod[],
  nowMs: number,
): number {
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
export function currentPeriod(
  periods: readonly ClockPeriod[],
): ClockPeriod | null {
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
export function isAtBreak(periods: readonly ClockPeriod[]): boolean {
  if (periods.length === 0) return false;
  if (isClockRunning(periods)) return false;
  const someEnded = periods.some((p) => p.ended);
  return someEnded && nextPeriodAfter(periods) !== null;
}

/**
 * Siguiente periodo a crear (el primero del orden que aún no existe) con su
 * `ordinal`. null si ya existen todos. No depende del estado de juego: solo de
 * qué periodos hay creados.
 */
export function nextPeriodAfter(
  periods: readonly ClockPeriod[],
): { period: PeriodKind; ordinal: number } | null {
  const existing = new Set(periods.map((p) => p.period));
  for (let i = 0; i < PERIOD_ORDER.length; i++) {
    const period = PERIOD_ORDER[i];
    if (period && !existing.has(period)) {
      return { period, ordinal: i + 1 };
    }
  }
  return null;
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
): NewPeriod | null {
  const next = nextPeriodAfter(periods);
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
export function pauseClockPatch(
  period: ClockPeriod,
  nowMs: number,
): ClockMutation {
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
export function endPeriodPatch(
  period: ClockPeriod,
  nowMs: number,
): ClockMutation {
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
