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
 * ¿El jugador está expulsado? Estado DERIVADO de sus tarjetas (F7.3, spec §3.4
 * bis): tiene **1 roja directa** O **2 amarillas**. No existe un evento de roja
 * "automática" por doble amarilla: la expulsión por dos amarillas es un estado,
 * no una fila aparte en `match_events`.
 */
export function isExpelled(existingTypes: readonly string[]): boolean {
  if (existingTypes.includes('red_card')) return true;
  return existingTypes.filter((t) => t === 'yellow_card').length >= 2;
}

/**
 * Desenlace de registrar una tarjeta/evento sobre un jugador, según su historial
 * de tarjetas en el partido (regla de expulsión, F7.3 — spec §3.4 bis):
 *
 *  - Un jugador YA expulsado (1 roja O 2 amarillas) NO puede recibir más eventos
 *    (ni una 2ª roja, ni gol/asistencia/amarilla) ⇒ `blocked: 'player_expelled'`.
 *  - En cualquier otro caso se registra el evento tal cual. La 2ª amarilla se
 *    registra como una amarilla MÁS (deja al jugador con 2 → expulsado por estado
 *    derivado); NO se crea ninguna roja.
 *
 * Pura y testeable: recibe los tipos de eventos PROPIOS ya registrados de ese
 * jugador y el tipo nuevo; no toca BD ni reloj.
 */
export type CardOutcome =
  | { kind: 'blocked'; reason: 'player_expelled' }
  | { kind: 'register' };

export function resolveCardOutcome(
  existingTypes: readonly string[],
  // newType se mantiene en la firma por claridad de intención y simetría con el
  // historial; la decisión depende solo del estado previo (ya expulsado o no).
  _newType: PlayerEventType,
): CardOutcome {
  if (isExpelled(existingTypes)) {
    return { kind: 'blocked', reason: 'player_expelled' };
  }
  return { kind: 'register' };
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
