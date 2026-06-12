/**
 * F9.4 / 9.B-2 — Carga la agregación MULTI-TEMPORADA (carrera) de un jugador.
 *
 * Spec 9.B §2.2 (regla 7): UNA query trae TODAS las filas de `match_player_stats`
 * del jugador con su `teams.season` (evita N+1); el agrupado/suma lo hace el core
 * (`careerBySeason`/`careerTotals`). El rating medio por temporada sale de
 * `evaluations` (otra query única) y se inyecta en `bySeason` para alimentar
 * `seasonComparison('rating')` — el core nunca fabrica el rating desde las stats.
 *
 * Seguridad: hereda la RLS de la sesión. Para staff, `evaluations` se lee del
 * club; para jugador/familia (/mi-ficha) la RLS de F8 las deja en 0 con el flag
 * de visibilidad OFF → el rating por temporada queda `null` (correcto).
 */

import {
  careerBySeason,
  careerTotals,
  createSupabaseServerClient,
  type SeasonStatRow,
  type SeasonStats,
  type CareerTotals,
  type MatchStatRow,
} from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

/** Una temporada de la carrera + su rating medio (para el gráfico de comparación). */
export type CareerSeason = SeasonStats & { rating: number | null };

export interface PlayerCareer {
  /** Por temporada (desc), con rating medio inyectado. Vacío si no hay partidos. */
  bySeason: CareerSeason[];
  /** Total de carrera (stats + ratios sobre el agregado). */
  totals: CareerTotals;
}

const STAT_COLUMNS =
  'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)';

export async function loadPlayerCareer(
  supabase: Supa,
  playerId: string
): Promise<PlayerCareer> {
  // 1) TODAS las filas de stats del jugador (todas las temporadas), una query.
  const { data: rawStats } = await supabase
    .from('match_player_stats')
    .select(STAT_COLUMNS)
    .eq('player_id', playerId);

  type StatJoin = MatchStatRow & { teams: { season: string } };

  const rows: SeasonStatRow[] = ((rawStats ?? []) as unknown as StatJoin[]).map(
    ({ teams, ...stat }) => ({ ...stat, season: teams.season })
  );

  // 2) Rating medio por temporada desde evaluations (otra query única). Solo
  //    cuentan los ratings no nulos; la RLS recorta la visibilidad.
  const { data: rawEvals } = await supabase
    .from('evaluations')
    .select('rating, teams!inner(season)')
    .eq('player_id', playerId);

  type EvalJoin = { rating: number | null; teams: { season: string } };
  const sumBySeason = new Map<string, { sum: number; n: number }>();
  for (const e of (rawEvals ?? []) as unknown as EvalJoin[]) {
    if (e.rating == null) continue;
    const season = e.teams.season;
    const acc = sumBySeason.get(season) ?? { sum: 0, n: 0 };
    acc.sum += e.rating;
    acc.n += 1;
    sumBySeason.set(season, acc);
  }
  function ratingFor(season: string): number | null {
    const acc = sumBySeason.get(season);
    return acc && acc.n > 0 ? acc.sum / acc.n : null;
  }

  // 3) Agregación en core + inyección del rating por temporada.
  const bySeason: CareerSeason[] = careerBySeason(rows).map((s) => ({
    ...s,
    rating: ratingFor(s.season),
  }));

  return { bySeason, totals: careerTotals(rows) };
}
