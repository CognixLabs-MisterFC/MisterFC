/**
 * F7.9 — Línea de tiempo editable (PURO, sin DOM ni red).
 *
 * 7.9 NO mantiene estado paralelo: TODO se deriva de `match_events`. Editar la
 * línea de tiempo (borrar / cambiar minuto / cambiar jugador / añadir) es, en el
 * fondo, mutar filas de `match_events`; minutos (7.8), marcador/penaltis (7.7c),
 * contadores de faltas/córners (7.4b) y expulsiones (7.3) se REDERIVAN de los
 * eventos resultantes con los motores que ya existen. Este módulo solo aporta lo
 * específico de la edición:
 *
 *  - Reanclar un evento a un MINUTO nuevo de forma coherente con el reloj
 *    (`clockFieldsForMinute` → `clock_seconds`/`period`/`display_minute`), usando
 *    el catálogo de periodos (§3.2/§6). Es la inversa de `displayMinute`.
 *  - Ordenar cronológicamente la línea (`sortTimeline`).
 *  - Detectar estados IMPOSIBLES tras una edición (`findTimelineIssues`) para
 *    AVISAR sin romper (spec 7.9): meter/eventar a un ausente, eventos sobre un
 *    expulsado posteriores a su expulsión, sustitución que mete a un ausente o a
 *    un expulsado.
 *
 * Todo aquí es puro y testeable (§15): recibe proyecciones camelCase de
 * `match_events` + el reloj, sin tocar BD.
 */

import {
  type ClockPeriod,
  type PeriodKind,
  displayMinute,
} from './clock';
import { isExpelled } from './event';

/**
 * Periodo que CONTIENE un instante absoluto del reloj (`clockSeconds`). El reloj
 * es monótono no decreciente y cada periodo arranca en su `baseOffsetSeconds`
 * (§6): el periodo del instante es el de mayor `baseOffsetSeconds` que no lo
 * supera. Antes del primer periodo → el primero. Sin periodos → null.
 */
export function periodAtClock(
  periods: readonly ClockPeriod[],
  clockSeconds: number,
): PeriodKind | null {
  if (periods.length === 0) return null;
  const ordered = [...periods].sort(
    (a, b) => a.baseOffsetSeconds - b.baseOffsetSeconds,
  );
  let chosen = ordered[0]!;
  for (const p of ordered) {
    if (p.baseOffsetSeconds <= clockSeconds) chosen = p;
    else break;
  }
  return chosen.period;
}

/** Campos de tiempo de un evento reanclado a un MINUTO de marcador concreto. */
export interface MinuteClockFields {
  clockSeconds: number;
  period: PeriodKind;
  displayMinute: number;
}

/**
 * Reancla un evento al MINUTO de marcador `minute` (entero ≥ 0): el segundo
 * absoluto es el inicio de ese minuto (`minute * 60`) y el periodo se deriva del
 * catálogo del reloj (`periodAtClock`). Coherente con `displayMinute` (la
 * inversa: `displayMinute(minute*60) === minute`). Si no hay periodos, devuelve
 * `first_half` por defecto (la capa de aplicación impide editar sin reloj).
 */
export function clockFieldsForMinute(
  periods: readonly ClockPeriod[],
  minute: number,
): MinuteClockFields {
  const safeMinute = Math.max(0, Math.floor(minute));
  const clockSeconds = safeMinute * 60;
  const period = periodAtClock(periods, clockSeconds) ?? 'first_half';
  return { clockSeconds, period, displayMinute: displayMinute(clockSeconds) };
}

/** Proyección mínima de un evento para ordenar la línea de tiempo. */
export interface TimelineOrderable {
  clockSeconds: number;
  /** ISO-8601 del alta; desempata eventos del mismo segundo (estable). */
  createdAt?: string | null;
}

/**
 * Ordena la línea de tiempo cronológicamente (clock_seconds asc; `created_at`
 * asc como desempate estable). NO muta la entrada. Cambiar el minuto de un
 * evento (que reescribe su `clock_seconds`) lo reubica al reordenar.
 */
export function sortTimeline<T extends TimelineOrderable>(
  events: readonly T[],
): T[] {
  return [...events].sort((a, b) => {
    if (a.clockSeconds !== b.clockSeconds) return a.clockSeconds - b.clockSeconds;
    const ca = a.createdAt ?? '';
    const cb = b.createdAt ?? '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación: estados imposibles tras una edición (avisar, no romper).
// ─────────────────────────────────────────────────────────────────────────────

/** Proyección de un evento para validar la coherencia de la línea de tiempo. */
export interface TimelineEventLite {
  id: string;
  side: 'own' | 'rival';
  type: string;
  playerId: string | null;
  /** Jugador que ENTRA en una sustitución. */
  relatedPlayerId: string | null;
  clockSeconds: number;
}

export interface TimelineContext {
  /** Jugadores marcados AUSENTES para el partido (match_absences). */
  absentIds: readonly string[];
}

export type TimelineIssueCode =
  | 'absent_has_event'
  | 'event_after_expulsion'
  | 'sub_in_absent'
  | 'sub_in_expelled';

/** Aviso (no error fatal) sobre un evento que deja la línea en estado imposible. */
export interface TimelineIssue {
  code: TimelineIssueCode;
  /** Evento que dispara el aviso. */
  eventId: string;
  /** Jugador implicado (el que sufre el estado imposible). */
  playerId: string | null;
}

/** Tipos de eventos PROPIOS que cuentan para la regla de expulsión. */
const CARD_TYPES = new Set(['yellow_card', 'red_card']);

/**
 * Segundo absoluto en el que cada jugador propio QUEDA expulsado (1 roja O 2ª
 * amarilla), recorriendo sus tarjetas en orden cronológico. Un jugador sin
 * expulsión no aparece en el mapa.
 */
function expulsionClockByPlayer(
  events: readonly TimelineEventLite[],
): Map<string, number> {
  const cards = events
    .filter((e) => e.side === 'own' && e.playerId && CARD_TYPES.has(e.type))
    .sort((a, b) => a.clockSeconds - b.clockSeconds);
  const seen = new Map<string, string[]>();
  const expelledAt = new Map<string, number>();
  for (const e of cards) {
    const pid = e.playerId!;
    if (expelledAt.has(pid)) continue; // ya expulsado: la 1ª expulsión manda
    const arr = seen.get(pid) ?? [];
    arr.push(e.type);
    seen.set(pid, arr);
    if (isExpelled(arr)) expelledAt.set(pid, e.clockSeconds);
  }
  return expelledAt;
}

/**
 * Detecta estados IMPOSIBLES en la línea de tiempo tras una edición, para AVISAR
 * sin bloquear (spec 7.9). Recorre los eventos resultantes y señala:
 *
 *  - `absent_has_event`     — un AUSENTE tiene un evento propio (no debería jugar).
 *  - `event_after_expulsion`— un jugador recibe un evento DESPUÉS de su expulsión.
 *  - `sub_in_absent`        — una sustitución mete a un AUSENTE.
 *  - `sub_in_expelled`      — una sustitución mete a un EXPULSADO.
 *
 * La tarjeta que PROVOCA la expulsión no se marca (es válida); solo lo posterior.
 */
export function findTimelineIssues(
  events: readonly TimelineEventLite[],
  context: TimelineContext,
): TimelineIssue[] {
  const absent = new Set(context.absentIds);
  const expelledAt = expulsionClockByPlayer(events);
  const issues: TimelineIssue[] = [];

  for (const e of events) {
    if (e.side === 'own' && e.playerId) {
      if (absent.has(e.playerId)) {
        issues.push({ code: 'absent_has_event', eventId: e.id, playerId: e.playerId });
      }
      const expClock = expelledAt.get(e.playerId);
      if (expClock != null && e.clockSeconds > expClock) {
        issues.push({
          code: 'event_after_expulsion',
          eventId: e.id,
          playerId: e.playerId,
        });
      }
    }
    if (e.type === 'substitution' && e.relatedPlayerId) {
      if (absent.has(e.relatedPlayerId)) {
        issues.push({ code: 'sub_in_absent', eventId: e.id, playerId: e.relatedPlayerId });
      }
      const expClock = expelledAt.get(e.relatedPlayerId);
      if (expClock != null && e.clockSeconds >= expClock) {
        issues.push({ code: 'sub_in_expelled', eventId: e.id, playerId: e.relatedPlayerId });
      }
    }
  }

  return issues;
}
