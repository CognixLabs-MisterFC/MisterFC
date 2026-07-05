/**
 * F9B-4b — Agregación de EVENTOS de partido a nivel de EQUIPO por tipo (PURO, sin
 * red ni DOM). Complementa a `aggregateTeamStats`/`splitMatchStatsByType`: cuenta
 * las métricas que viven SOLO en `match_events` (corners, fueras de juego, faltas,
 * etc.) y que no están en `match_player_stats`.
 *
 * Reutiliza `classifyMatchType` (F9B-1) — NO redefine la regla de clasificación por
 * `(events.type, events.tournament_id)`. Separa el bando:
 *  - `side='own'`  → conteos por TIPO (Oficial/Amistoso/Torneo) + Total.
 *  - `side='rival'` → conteos SOLO en Total (el rival no se desglosa por tipo,
 *    decisión de producto: aparece como una columna Rival única).
 *
 * El shape es un mapa de conteos por `match_events.type` (distinto de
 * `AggregatedStats`), así que soporta cualquier tipo capturado sin acoplarse a un
 * conjunto fijo de columnas.
 */

import { classifyMatchType } from './by-type';

/** Fila de `match_events` + el tipo/torneo de su evento padre, para clasificar. */
export interface TeamEventRow {
  /** Bando del evento. */
  side: 'own' | 'rival';
  /** `match_events.type` (goal, assist, corner, foul, offside, shot, …). */
  kind: string;
  /** `events.type` del partido padre (match/friendly/tournament). */
  eventType: string;
  /** `events.tournament_id` del partido padre (null si no es de torneo). */
  tournamentId: string | null;
}

/** Conteo de eventos por `match_events.type`. Claves ausentes = 0. */
export type EventCountMap = Record<string, number>;

/** Conteos de eventos de equipo: `own` por tipo + total; `rival` solo total. */
export interface TeamEventsAggregate {
  own: {
    total: EventCountMap;
    oficial: EventCountMap;
    amistoso: EventCountMap;
    torneo: EventCountMap;
  };
  /** Conteos del rival (side='rival'), solo total (sin desglose por tipo). */
  rivalTotal: EventCountMap;
}

function bump(map: EventCountMap, kind: string): void {
  map[kind] = (map[kind] ?? 0) + 1;
}

/**
 * Cuenta `match_events` a nivel de equipo por `(bando, tipo-de-partido, tipo-de-evento)`.
 * Las filas cuyo partido padre no clasifica como partido (p.ej. 'other'/'training')
 * se ignoran. Puro y agnóstico del orden.
 */
export function aggregateTeamEventsByType(
  rows: readonly TeamEventRow[],
): TeamEventsAggregate {
  const own: TeamEventsAggregate['own'] = {
    total: {},
    oficial: {},
    amistoso: {},
    torneo: {},
  };
  const rivalTotal: EventCountMap = {};

  for (const r of rows) {
    const group = classifyMatchType(r.eventType, r.tournamentId);
    if (!group) continue; // no es un partido → fuera del total
    if (r.side === 'own') {
      bump(own[group], r.kind);
      bump(own.total, r.kind);
    } else {
      bump(rivalTotal, r.kind);
    }
  }

  return { own, rivalTotal };
}
