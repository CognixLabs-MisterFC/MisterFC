/**
 * F7B-0 — Derivación PURA de { fase, minuto } del partido a partir del reloj YA
 * persistido en `match_state.status` + `match_periods` (F7.1). Fuente ÚNICA para
 * el directo (staff) y la futura pantalla de familias (F7B-3/4): dos llamadas con
 * los mismos datos dan el mismo resultado en cualquier dispositivo, sin I/O.
 *
 * No añade estado: `match_periods.last_started_at` (hora de servidor) +
 * `accumulated_seconds` ya hacen el minuto reconstruible; aquí solo lo traducimos
 * a semántica de FÚTBOL (offset por parte + añadido) y a una etiqueta de fase.
 *
 * ── Semántica del minuto (decisión de producto F7B) ──────────────────────────
 * El minuto NO es el reloj real acumulado (`clockSecondsAt`), sino el minuto de
 * marcador de fútbol:
 *   · 1ª parte: cuenta desde 0 (0', 1', 2'… conforme pasan los minutos).
 *   · 2ª parte: arranca con OFFSET = duración de una parte (`half_duration_minutes`
 *     de la categoría). Media parte de 25' → la 2ª empieza mostrando 25', 26'…
 *   · Prórroga: continúa con el offset acumulado (2×duración + prórrogas previas).
 *   · Añadido: si el tiempo dentro de la parte supera su duración nominal, el
 *     minuto base se congela en el tope y se reporta `addedTime` (25'+1, 25'+2…).
 *   · Descanso / fin: minuto CONGELADO (el periodo no corre → sin elapsed).
 * `minute` es 0-indexado por convención de reloj (el tick a "1'" ocurre al cumplir
 * el primer minuto); la UI decide cómo rotularlo. `addedTime` = minutos de
 * descuento (0 si se está dentro de la duración nominal).
 */

import {
  type ClockPeriod,
  type PeriodKind,
  currentPeriod,
  isAtBreak,
  isClockRunning,
  isExtraPeriod,
  periodClockSeconds,
} from './clock';

export type MatchStatus = 'not_started' | 'live' | 'closed';

/**
 * Fase mostrable del partido. `half_time` cubre CUALQUIER descanso entre periodos
 * (1ª→2ª y también antes de la prórroga). `penalties` = tanda de desempate (el
 * minuto se congela: no es tiempo jugado). `finished` = partido cerrado o con
 * todos los periodos agotados.
 */
export type MatchPhaseKind =
  | 'not_started'
  | 'first_half'
  | 'half_time'
  | 'second_half'
  | 'extra_time'
  | 'penalties'
  | 'finished';

export interface MatchPhaseInput {
  status: MatchStatus;
  periods: readonly ClockPeriod[];
  /** Duración nominal de cada parte regular (min), de la categoría. */
  halfDurationMinutes: number;
  /** Instante de evaluación (ms). Para un periodo en curso, avanza el minuto. */
  nowMs: number;
  /** Duración nominal de cada mitad de prórroga (min). Por defecto = halfDurationMinutes. */
  extraHalfDurationMinutes?: number;
}

export interface MatchPhaseResult {
  phase: MatchPhaseKind;
  /** Minuto de marcador (offset de la parte + minutos transcurridos), congelado en descanso/fin. */
  minute: number;
  /** Minutos de añadido más allá de la duración nominal de la parte (0 si dentro). */
  addedTime: number;
}

/** Familia de fase de un periodo del reloj. */
function phaseKindOf(period: PeriodKind): MatchPhaseKind {
  switch (period) {
    case 'first_half':
      return 'first_half';
    case 'second_half':
      return 'second_half';
    case 'extra_first':
    case 'extra_second':
      return 'extra_time';
    case 'penalties':
      return 'penalties';
  }
}

/** Offset de marcador (min) con el que ARRANCA una parte = suma nominal de las previas. */
function footballBaseMinutes(
  period: PeriodKind,
  halfMin: number,
  extraMin: number,
): number {
  switch (period) {
    case 'first_half':
      return 0;
    case 'second_half':
      return halfMin;
    case 'extra_first':
      return 2 * halfMin;
    case 'extra_second':
      return 2 * halfMin + extraMin;
    case 'penalties':
      return 2 * halfMin + 2 * extraMin;
  }
}

/** Duración nominal (min) de un periodo: regular = half, prórroga = extra. */
function nominalMinutes(
  period: PeriodKind,
  halfMin: number,
  extraMin: number,
): number {
  return isExtraPeriod(period) ? extraMin : halfMin;
}

/** { minute, addedTime } de un periodo dado su tiempo real transcurrido dentro. */
function footballMinuteOf(
  period: ClockPeriod,
  nowMs: number,
  halfMin: number,
  extraMin: number,
): { minute: number; addedTime: number } {
  // Tiempo real transcurrido DENTRO del periodo = reloj del periodo − su base
  // absoluto (independiente del offset de marcador). Para un periodo en pausa/
  // terminado no corre → congelado; para el activo avanza con nowMs.
  const withinSeconds = Math.max(
    0,
    periodClockSeconds(period, nowMs) - period.baseOffsetSeconds,
  );
  const withinMin = Math.floor(withinSeconds / 60);
  const base = footballBaseMinutes(period.period, halfMin, extraMin);
  const nominal = nominalMinutes(period.period, halfMin, extraMin);

  if (withinMin < nominal) {
    return { minute: base + withinMin, addedTime: 0 };
  }
  // Descuento: el minuto base se congela en el tope de la parte y se cuenta "+X".
  return { minute: base + nominal, addedTime: withinMin - nominal + 1 };
}

/**
 * Deriva { fase, minuto, añadido } del partido de forma pura y reconstruible.
 * Reglas de fase (con status='live'):
 *   - hay periodo corriendo → la fase de ese periodo.
 *   - periodo en pausa sin terminar → sigue siendo la fase de ese periodo.
 *   - todos parados y alguno terminado con más por jugar → 'half_time' (descanso).
 *   - todos terminados sin más por jugar → 'finished'.
 * El minuto se toma del periodo TEMPORIZADO actual (excluye la tanda de penaltis,
 * que no es tiempo jugado): en descanso/fin queda congelado en el último jugado.
 */
export function matchPhase(input: MatchPhaseInput): MatchPhaseResult {
  const { status, periods, halfDurationMinutes, nowMs } = input;
  const halfMin = halfDurationMinutes;
  const extraMin = input.extraHalfDurationMinutes ?? halfDurationMinutes;

  if (status === 'not_started' || periods.length === 0) {
    return { phase: 'not_started', minute: 0, addedTime: 0 };
  }

  // Minuto desde el periodo temporizado actual (la tanda no cuenta como tiempo).
  const timed = periods.filter((p) => p.period !== 'penalties');
  const timedCur = currentPeriod(timed);
  const { minute, addedTime } = timedCur
    ? footballMinuteOf(timedCur, nowMs, halfMin, extraMin)
    : { minute: 0, addedTime: 0 };

  let phase: MatchPhaseKind;
  if (status === 'closed') {
    phase = 'finished';
  } else if (isClockRunning(periods)) {
    const running = periods.find((p) => p.running);
    phase = running ? phaseKindOf(running.period) : 'not_started';
  } else {
    const cur = currentPeriod(periods);
    if (cur && !cur.ended) {
      phase = phaseKindOf(cur.period); // en periodo, en pausa
    } else if (isAtBreak(periods)) {
      phase = 'half_time';
    } else {
      phase = 'finished'; // todos los periodos agotados (a la espera de cierre)
    }
  }

  return { phase, minute, addedTime };
}
