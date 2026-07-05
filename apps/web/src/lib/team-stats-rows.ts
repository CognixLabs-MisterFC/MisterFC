/**
 * F9B-4b — Construcción de las filas del bloque "Totales del equipo" por tipo,
 * COMPARTIDA por la vista web y el PDF de equipo para no divergir (mismos números
 * y mismo orden). Recibe el desglose ya calculado (`TeamStatsByType`, del loader) y
 * un resolvedor de etiquetas i18n; devuelve filas ya formateadas como string para
 * `MatchStatsByTypeTable` (web) o para la tabla del PDF.
 *
 * Reglas de fuente por métrica (decisiones F9B-4b):
 *  - Goles del equipo = MARCADOR (match_state.goals_for), no la Σ de goles de
 *    jugador; columna Rival = goles en contra (goals_against).
 *  - Corners / Fueras de juego = conteos de match_events (no están en
 *    match_player_stats). Rival = su conteo side='rival'.
 *  - Resto summables (asistencias, tiros, faltas, tarjetas, penaltis, minutos) =
 *    Σ match_player_stats (4a). Rival = conteo side='rival' donde aplique; "—" si no
 *    hay contraparte capturada (asistencias, faltas recibidas, penaltis, minutos).
 *  - Partidos = partidos reales por tipo (distinct event_id); Rival "—".
 *  - NO hay "% titularidad" a nivel de equipo (métrica de jugador).
 */

import type { AggregatedStats } from '@misterfc/core';
import type { MatchStatsByTypeRow } from '@/components/stats/match-stats-by-type-table';
import type { TeamStatsByType } from '@/app/[locale]/(authenticated)/equipos/[teamId]/team-stats-queries';

export function buildTeamByTypeRows(
  byType: TeamStatsByType,
  label: (key: string) => string,
  na = '—',
): MatchStatsByTypeRow[] {
  const s = byType.stats;
  const ev = byType.events;
  const S = (n: number) => String(n);
  const rivalEv = (kind: string) => S(ev.rivalTotal[kind] ?? 0);

  // Métrica summable (Σ match_player_stats) por tipo, con su valor de Rival.
  const sumRow = (
    key: string,
    pick: (a: AggregatedStats) => number,
    rival: string,
  ): MatchStatsByTypeRow => ({
    key,
    label: label(key),
    cells: {
      amistoso: S(pick(s.amistoso)),
      torneo: S(pick(s.torneo)),
      oficial: S(pick(s.oficial)),
      total: S(pick(s.total)),
      rival,
    },
  });

  // Métrica de conteo de eventos (match_events) por tipo, con su valor de Rival.
  const evRow = (
    key: string,
    kind: string,
    rival: string,
  ): MatchStatsByTypeRow => ({
    key,
    label: label(key),
    cells: {
      amistoso: S(ev.own.amistoso[kind] ?? 0),
      torneo: S(ev.own.torneo[kind] ?? 0),
      oficial: S(ev.own.oficial[kind] ?? 0),
      total: S(ev.own.total[kind] ?? 0),
      rival,
    },
  });

  return [
    // Partidos reales por tipo; el rival juega los mismos → "—".
    {
      key: 'matches',
      label: label('matches'),
      cells: {
        amistoso: S(byType.matches.amistoso),
        torneo: S(byType.matches.torneo),
        oficial: S(byType.matches.oficial),
        total: S(byType.matches.total),
        rival: na,
      },
    },
    // Goles a favor (marcador) por tipo; Rival = goles en contra.
    {
      key: 'goals',
      label: label('goals'),
      cells: {
        amistoso: S(byType.goalsFor.amistoso),
        torneo: S(byType.goalsFor.torneo),
        oficial: S(byType.goalsFor.oficial),
        total: S(byType.goalsFor.total),
        rival: S(byType.goalsAgainst),
      },
    },
    sumRow('assists', (a) => a.assists, na),
    sumRow('shots', (a) => a.shots, rivalEv('shot')),
    evRow('corners', 'corner', rivalEv('corner')),
    sumRow('fouls_committed', (a) => a.foulsCommitted, rivalEv('foul')),
    sumRow('fouls_received', (a) => a.foulsReceived, na),
    evRow('offsides', 'offside', rivalEv('offside')),
    sumRow('yellow', (a) => a.yellowCards, rivalEv('yellow_card')),
    sumRow('red', (a) => a.redCards, rivalEv('red_card')),
    sumRow('penalties_scored', (a) => a.penaltiesScored, na),
    sumRow('penalties_missed', (a) => a.penaltiesMissed, na),
    sumRow('minutes', (a) => a.minutesPlayed, na),
  ];
}
