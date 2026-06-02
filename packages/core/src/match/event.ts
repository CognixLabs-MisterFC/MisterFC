/**
 * F7.3 — Dominio de los eventos del partido SOBRE UN JUGADOR (gol, asistencia,
 * tarjetas). Puro y agnóstico de framework/BD.
 *
 * Los eventos de campo (córner, falta, fuera de juego, tiro → §3.4 con x/y) son
 * 7.4, y las sustituciones 7.5; aquí solo los que se asignan a un jugador propio
 * con un toque/arrastre (§7.3 / onPlayerClick).
 */

import {
  clockSecondsAt,
  currentPeriod,
  displayMinute,
  type ClockPeriod,
  type PeriodKind,
} from './clock';

/** Tipos de match_events que se registran TOCANDO a un jugador (7.3). */
export type PlayerEventType = 'goal' | 'assist' | 'yellow_card' | 'red_card';

export const PLAYER_EVENT_TYPES: readonly PlayerEventType[] = [
  'goal',
  'assist',
  'yellow_card',
  'red_card',
] as const;

export function isPlayerEventType(value: string): value is PlayerEventType {
  return (PLAYER_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Desenlace de registrar una tarjeta/evento sobre un jugador, según su historial
 * de tarjetas en el partido (regla de expulsión, F7.3 — añadida a la spec §3.4):
 *
 *  - 2ª amarilla al mismo jugador ⇒ expulsión automática (además de la amarilla,
 *    se registra la roja correspondiente, `autoRed`).
 *  - 1 roja directa ⇒ expulsado.
 *  - Un jugador YA expulsado (tiene roja) NO puede recibir más eventos (ni una 2ª
 *    roja, ni gol/asistencia/amarilla) ⇒ `blocked: 'player_expelled'`.
 *
 * Pura y testeable: recibe los tipos de eventos PROPIOS ya registrados de ese
 * jugador y el tipo nuevo; no toca BD ni reloj.
 */
export type CardOutcome =
  | { kind: 'blocked'; reason: 'player_expelled' }
  | { kind: 'register'; autoRed: boolean };

export function resolveCardOutcome(
  existingTypes: readonly string[],
  newType: PlayerEventType,
): CardOutcome {
  const hasRed = existingTypes.includes('red_card');
  if (hasRed) return { kind: 'blocked', reason: 'player_expelled' };

  const yellows = existingTypes.filter((t) => t === 'yellow_card').length;
  // Esta amarilla sería la 2ª → doble amarilla = expulsión.
  const autoRed = newType === 'yellow_card' && yellows >= 1;
  return { kind: 'register', autoRed };
}

/** ¿El jugador está expulsado? (tiene una roja propia registrada). */
export function isExpelled(existingTypes: readonly string[]): boolean {
  return existingTypes.includes('red_card');
}

/** Campos de tiempo de un evento que ocurre AHORA (§3.4/§6), derivados del reloj. */
export interface PlayerEventClockFields {
  /** Segundos absolutos de juego (cálculo fiable de minutos, §6). */
  clockSeconds: number;
  /** Periodo en curso (para `match_events.period`). */
  period: PeriodKind;
  /** Minuto de marcador para mostrar (`match_events.display_minute`). */
  displayMinute: number;
}

/**
 * Resuelve `clock_seconds` + `period` + `display_minute` de un evento que se
 * registra en el instante `nowMs`, a partir del reloj de 7.7 (`match_periods`).
 * Sin periodos (partido sin iniciar) → reloj 0 y `first_half` por defecto, pero
 * la capa de aplicación debe impedir registrar si el partido no está en vivo.
 */
export function playerEventClockFields(
  periods: readonly ClockPeriod[],
  nowMs: number,
): PlayerEventClockFields {
  const clockSeconds = clockSecondsAt(periods, nowMs);
  const cur = currentPeriod(periods);
  return {
    clockSeconds,
    period: cur?.period ?? 'first_half',
    displayMinute: displayMinute(clockSeconds),
  };
}
