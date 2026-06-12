/**
 * F9.B-0 — Agregación de estadísticas de un EQUIPO en una temporada (PURO, sin
 * red ni DOM). Habilitador de 9.B-3 (vista de stats por equipo) y del PDF de
 * equipo (9.8).
 *
 * Spec 9.B §4.3: sobre el roster del equipo (jugadores con membresía en ese
 * team, que en el modelo Rework C es season-scoped — `teams.season` es un único
 * label por fila de equipo) se suman las filas de `match_player_stats` por
 * jugador reutilizando `sumMatchStats`, y se derivan los ratios con
 * `derivedRatios`.
 *
 * Decisiones cerradas (#108):
 *  - **Ratios sobre los AGREGADOS**, nunca media de medias: los ratios del
 *    equipo se calculan sobre los totales del equipo (Σgoles·90 / Σmin), no
 *    promediando los ratios de cada jugador.
 *  - Cada jugador del roster aparece SIEMPRE, aunque tenga 0 partidos (stats a
 *    cero) — la plantilla completa es parte del reporte.
 *  - Los totales del equipo = Σ de los agregados por jugador del roster (el
 *    invariante `totals == Σ perPlayer.stats` se mantiene por construcción).
 *
 * Aquí NO hay acceso a BD: el server lee roster + filas y se las pasa; así se
 * testea con Vitest sin Supabase. La agregación cross-temporada de un JUGADOR
 * (9.4) es otro helper.
 */

import {
  sumMatchStats,
  emptyAggregatedStats,
  type MatchStatRow,
  type AggregatedStats,
} from './aggregate';
import { derivedRatios, type DerivedRatios } from './derived';

/** Una fila de `match_player_stats` etiquetada con el jugador al que pertenece. */
export interface PlayerMatchStatRow extends MatchStatRow {
  player_id: string;
}

/**
 * Un jugador del roster del equipo en la temporada (time-aware: el server trae
 * todas las membresías del team, activas e históricas, porque el team es
 * season-scoped). Lleva los datos de identidad que la UI/PDF necesitarán luego.
 */
export interface RosterPlayer {
  player_id: string;
  first_name: string;
  last_name: string | null;
  dorsal_in_team: number | null;
  position_in_team: string | null;
}

/** Agregado de un jugador dentro del equipo: identidad + stats + ratios. */
export interface PlayerTeamStats extends RosterPlayer {
  stats: AggregatedStats;
  ratios: DerivedRatios;
}

export interface TeamAggregate {
  /** Una entrada por jugador del roster (incluye los de 0 partidos). */
  perPlayer: PlayerTeamStats[];
  /** Totales del equipo = Σ de los agregados por jugador del roster. */
  totals: AggregatedStats;
  /** Ratios del equipo, calculados SOBRE los totales (no media de medias). */
  totalsRatios: DerivedRatios;
}

/** Suma campo a campo dos agregados (acumulador de totales de equipo). */
function addAggregated(
  acc: AggregatedStats,
  s: AggregatedStats
): AggregatedStats {
  return {
    matches: acc.matches + s.matches,
    starts: acc.starts + s.starts,
    minutesPlayed: acc.minutesPlayed + s.minutesPlayed,
    goals: acc.goals + s.goals,
    assists: acc.assists + s.assists,
    yellowCards: acc.yellowCards + s.yellowCards,
    redCards: acc.redCards + s.redCards,
    shots: acc.shots + s.shots,
    foulsCommitted: acc.foulsCommitted + s.foulsCommitted,
    foulsReceived: acc.foulsReceived + s.foulsReceived,
    penaltiesScored: acc.penaltiesScored + s.penaltiesScored,
    penaltiesMissed: acc.penaltiesMissed + s.penaltiesMissed,
  };
}

/**
 * Agrega las stats de un equipo en una temporada: por jugador del roster y
 * totales del equipo. Conserva el orden del roster (el server lo ordena). Las
 * filas cuyo `player_id` no esté en el roster se ignoran (no debería ocurrir:
 * `team_members` conserva el histórico del equipo, que es season-scoped).
 */
export function aggregateTeamStats(
  roster: readonly RosterPlayer[],
  rows: readonly PlayerMatchStatRow[]
): TeamAggregate {
  // Agrupa las filas por jugador (una pasada).
  const byPlayer = new Map<string, MatchStatRow[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.player_id);
    if (list) list.push(r);
    else byPlayer.set(r.player_id, [r]);
  }

  const perPlayer: PlayerTeamStats[] = roster.map((p) => {
    const stats = sumMatchStats(byPlayer.get(p.player_id) ?? []);
    return {
      player_id: p.player_id,
      first_name: p.first_name,
      last_name: p.last_name,
      dorsal_in_team: p.dorsal_in_team,
      position_in_team: p.position_in_team,
      stats,
      ratios: derivedRatios(stats),
    };
  });

  // Totales = Σ de los agregados del roster (invariante totals == Σ perPlayer).
  const totals = perPlayer.reduce(
    (acc, p) => addAggregated(acc, p.stats),
    emptyAggregatedStats()
  );

  return { perPlayer, totals, totalsRatios: derivedRatios(totals) };
}
