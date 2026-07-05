/**
 * F9B — Desglose de estadísticas de PARTIDO por TIPO de evento (PURO, sin red ni DOM).
 *
 * La ficha del jugador (y su PDF) muestran las métricas de partido desglosadas en
 * cuatro columnas: Total · Oficial · Amistoso · Torneo. La clasificación es EXACTA
 * (spec F9B) y depende de `events.type` + `events.tournament_id`:
 *   - Oficial  = type='match'    AND tournament_id IS NULL
 *   - Amistoso = type='friendly'
 *   - Torneo   = type='match'    AND tournament_id IS NOT NULL  (sub-partidos)
 *   - Total    = Oficial + Amistoso + Torneo (ignora 'other'/'training'/otros)
 *
 * Reutiliza `sumMatchStats` por grupo (no reinventa el sumatorio). El caller lee las
 * filas de `match_player_stats` con el `type`/`tournament_id` de su `events`; aquí se
 * clasifica y agrega, así se testea con Vitest sin BD.
 */

import {
  emptyAggregatedStats,
  sumMatchStats,
  type AggregatedStats,
  type MatchStatRow,
} from './aggregate';

/** Grupo de clasificación de un partido para el desglose. */
export type MatchStatsGroup = 'oficial' | 'amistoso' | 'torneo';

/** Fila de `match_player_stats` + el tipo/torneo de su evento, para clasificar. */
export interface MatchStatRowTyped extends MatchStatRow {
  /** `events.type` del partido. */
  eventType: string;
  /** `events.tournament_id` (null en partido suelto; set en sub-partido de torneo). */
  tournamentId: string | null;
}

/**
 * Clasifica un partido en su grupo (Oficial/Amistoso/Torneo) según la regla F9B.
 * Devuelve `null` para tipos que NO cuentan como partido (training/other/…): esas
 * filas se ignoran en el desglose y en el Total.
 */
export function classifyMatchType(
  eventType: string,
  tournamentId: string | null,
): MatchStatsGroup | null {
  if (eventType === 'friendly') return 'amistoso';
  if (eventType === 'match') {
    return tournamentId == null ? 'oficial' : 'torneo';
  }
  return null;
}

/** Agregados de partido por tipo. `total` = oficial + amistoso + torneo. */
export interface MatchStatsByType {
  total: AggregatedStats;
  oficial: AggregatedStats;
  amistoso: AggregatedStats;
  torneo: AggregatedStats;
}

/**
 * Parte las filas de `match_player_stats` (ya leídas, con `eventType`/`tournamentId`)
 * en los tres grupos + el Total, cada uno un `AggregatedStats` vía `sumMatchStats`.
 * Las filas cuyo tipo no clasifica como partido (p.ej. 'other') se descartan y NO
 * entran en el Total. Puro y agnóstico del orden.
 */
export function splitMatchStatsByType(
  rows: readonly MatchStatRowTyped[],
): MatchStatsByType {
  const oficial: MatchStatRow[] = [];
  const amistoso: MatchStatRow[] = [];
  const torneo: MatchStatRow[] = [];
  for (const r of rows) {
    const group = classifyMatchType(r.eventType, r.tournamentId);
    if (group === 'oficial') oficial.push(r);
    else if (group === 'amistoso') amistoso.push(r);
    else if (group === 'torneo') torneo.push(r);
    // group === null → ignorada (no es partido).
  }
  return {
    // Total = solo las filas que clasificaron como partido (las tres listas juntas),
    // así Total = Oficial + Amistoso + Torneo por construcción.
    total: sumMatchStats([...oficial, ...amistoso, ...torneo]),
    oficial: oficial.length ? sumMatchStats(oficial) : emptyAggregatedStats(),
    amistoso: amistoso.length ? sumMatchStats(amistoso) : emptyAggregatedStats(),
    torneo: torneo.length ? sumMatchStats(torneo) : emptyAggregatedStats(),
  };
}
