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
  type PeriodCount,
  type PeriodKind,
  currentPeriod,
  isAtBreak,
  isClockRunning,
  isExtraPeriod,
  periodClockSeconds,
  periodOrder,
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
  | 'third_period'
  | 'extra_time'
  | 'penalties'
  | 'finished';

/**
 * ¿En esta fase el MINUTO significa algo? (el reloj está en juego). Las cinco
 * pantallas del directo —web listado, web detalle, nativa listado, nativa
 * familia, nativa staff— mostraban el minuto si la fase estaba en un
 * `Set(['first_half','second_half','extra_time'])` escrito a mano EN CADA UNA.
 * Cinco copias de la misma verdad, y ninguna conocía el tercer tiempo: en un
 * partido de querubines las cinco habrían dejado de enseñar el minuto justo en
 * el último tiempo.
 *
 * ── POR QUÉ UN `Record` Y NO UN `Set` ───────────────────────────────────────
 * Un `Set` al que le falta un valor es un `Set` válido, así que el compilador
 * no dice nada: eso es exactamente lo que acaba de pasar cinco veces. Un
 * `Record<MatchPhaseKind, boolean>` obliga a enumerar TODAS las fases, de modo
 * que la próxima que se añada no compila hasta que alguien decida si cuenta
 * como tiempo de juego. No es un aviso: lo IMPIDE.
 */
const MINUTO_POR_FASE: Record<MatchPhaseKind, boolean> = {
  not_started: false,
  first_half: true,
  half_time: false, // descanso: el minuto está congelado, se rotula la fase
  second_half: true,
  third_period: true,
  extra_time: true,
  penalties: false, // la tanda no es tiempo jugado
  finished: false,
};

/** ¿Se muestra el minuto en esta fase, o la etiqueta de la fase? */
export function phaseShowsMinute(phase: MatchPhaseKind): boolean {
  return MINUTO_POR_FASE[phase];
}

export interface MatchPhaseInput {
  status: MatchStatus;
  periods: readonly ClockPeriod[];
  /** Duración nominal de cada periodo regular (min), de la categoría. */
  halfDurationMinutes: number;
  /**
   * Cuántos periodos regulares juega la categoría (`categories.period_count`):
   * dos partes o tres tiempos. OBLIGATORIO y sin valor por defecto a propósito:
   * un `= 2` aquí dejaría a cada sitio que se olvide contando un partido de
   * querubines como si tuviera dos partes, y el error no se vería hasta que
   * alguien abriera ese directo. Se pasa `asPeriodCount(categoria.period_count)`.
   */
  periodCount: PeriodCount;
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
    case 'third_period':
      return 'third_period';
    case 'extra_first':
    case 'extra_second':
      return 'extra_time';
    case 'penalties':
      return 'penalties';
  }
}

/**
 * Offset de marcador (min) con el que ARRANCA un periodo = suma nominal de los
 * que van antes EN SU CATEGORÍA.
 *
 * Antes era un `switch` con las cinco cuentas escritas a mano (`2 * halfMin`
 * para la prórroga, y así). Eso solo podía ser correcto mientras hubiera
 * exactamente dos periodos regulares: con tres, la prórroga arranca en
 * `3 * halfMin` y ninguna de esas constantes valía. Sumar el orden real no tiene
 * ese problema y no hay que volver a tocarlo si mañana hay cuatro.
 */
function footballBaseMinutes(
  period: PeriodKind,
  halfMin: number,
  extraMin: number,
  count: PeriodCount,
): number {
  // Una fila `third_period` en una categoría que HOY dice dos no es un dato
  // imposible: se jugó cuando la categoría decía tres y alguien la cambió
  // después, y ese partido se sigue mirando. Sumando el orden de dos, el bucle
  // no encontraría nunca el periodo y devolvería la suma ENTERA (cinco periodos
  // nominales: 60' con tiempos de doce), un offset inventado. Se cuenta con el
  // orden que sí contiene ese periodo, que es el que se jugó.
  const orden = periodOrder(count).includes(period)
    ? periodOrder(count)
    : periodOrder(3);
  let base = 0;
  for (const previo of orden) {
    if (previo === period) return base;
    base += nominalMinutes(previo, halfMin, extraMin);
  }
  // Inalcanzable: periodOrder(3) contiene los seis PeriodKind.
  return base;
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
  count: PeriodCount,
): { minute: number; addedTime: number } {
  // Tiempo real transcurrido DENTRO del periodo = reloj del periodo − su base
  // absoluto (independiente del offset de marcador). Para un periodo en pausa/
  // terminado no corre → congelado; para el activo avanza con nowMs.
  const withinSeconds = Math.max(
    0,
    periodClockSeconds(period, nowMs) - period.baseOffsetSeconds,
  );
  const withinMin = Math.floor(withinSeconds / 60);
  const base = footballBaseMinutes(period.period, halfMin, extraMin, count);
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
  const { status, periods, halfDurationMinutes, nowMs, periodCount } = input;
  const halfMin = halfDurationMinutes;
  const extraMin = input.extraHalfDurationMinutes ?? halfDurationMinutes;

  if (status === 'not_started' || periods.length === 0) {
    return { phase: 'not_started', minute: 0, addedTime: 0 };
  }

  // Minuto desde el periodo temporizado actual (la tanda no cuenta como tiempo).
  const timed = periods.filter((p) => p.period !== 'penalties');
  const timedCur = currentPeriod(timed);
  const { minute, addedTime } = timedCur
    ? footballMinuteOf(timedCur, nowMs, halfMin, extraMin, periodCount)
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
    } else if (isAtBreak(periods, periodCount)) {
      phase = 'half_time';
    } else {
      phase = 'finished'; // todos los periodos agotados (a la espera de cierre)
    }
  }

  return { phase, minute, addedTime };
}
