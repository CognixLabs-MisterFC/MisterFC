/**
 * F9.4 / 9.B-1 — Agregación MULTI-TEMPORADA de un jugador (PURO, sin red ni DOM).
 *
 * Spec 9.B §2: la "carrera" del jugador = sus stats a través de TODAS las
 * temporadas. El server lee las filas de `match_player_stats` del jugador de
 * toda su trayectoria, cada una etiquetada con la temporada del equipo
 * (`teams.season`), y se las pasa a estos helpers. Aquí NO hay acceso a BD: solo
 * se agrupa/suma/deriva reutilizando los helpers per-temporada existentes
 * (`sumMatchStats`, `derivedRatios`); así se testea con Vitest sin Supabase.
 *
 * Decisiones cerradas (#108):
 *  - **D1 — ratios sobre los AGREGADOS, nunca media de medias**: los ratios de
 *    cada temporada se derivan de su SUMA, y los de carrera del total de
 *    carrera (Σgoles·90 / Σmin), no promediando ratios.
 *  - **D2 — multi-equipo en una misma temporada SUMA**: como agrupamos por
 *    label de temporada, las filas de dos equipos en la misma temporada caen en
 *    el mismo grupo y se suman (un partido es de un equipo; sumar equipos dentro
 *    de la temporada es correcto).
 *  - El rating NO vive en `AggregatedStats` (sale de `evaluations`); por eso
 *    `seasonComparison` lo lee de un campo opcional por temporada y nunca lo
 *    fabrica desde las stats.
 */

import {
  sumMatchStats,
  type MatchStatRow,
  type AggregatedStats,
} from './aggregate';
import { derivedRatios, type DerivedRatios } from './derived';

/** Una fila de `match_player_stats` etiquetada con su temporada (`teams.season`). */
export type SeasonStatRow = MatchStatRow & { season: string };

/** Agregado de una temporada del jugador: label + totales + ratios. */
export interface SeasonStats {
  season: string;
  stats: AggregatedStats;
  ratios: DerivedRatios;
}

/** Total de la carrera del jugador: totales de todas las temporadas + ratios. */
export interface CareerTotals {
  stats: AggregatedStats;
  ratios: DerivedRatios;
}

/**
 * Agrupa las filas por temporada, suma cada grupo con `sumMatchStats` y deriva
 * sus ratios con `derivedRatios`. Devuelve una entrada por temporada, en orden
 * **descendente** por label (`'2026-27'` antes que `'2025-26'`). Multi-equipo en
 * una misma temporada se suma (mismo grupo).
 */
export function careerBySeason(
  rows: readonly SeasonStatRow[]
): SeasonStats[] {
  const bySeason = new Map<string, MatchStatRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season);
    if (list) list.push(r);
    else bySeason.set(r.season, [r]);
  }

  return Array.from(bySeason.entries())
    .map(([season, group]) => {
      const stats = sumMatchStats(group);
      return { season, stats, ratios: derivedRatios(stats) };
    })
    .sort((a, b) => b.season.localeCompare(a.season));
}

/**
 * Total de carrera: `sumMatchStats` de TODAS las filas (sin importar temporada)
 * + `derivedRatios` sobre ese total (D1: ratios sobre el agregado, no media de
 * medias). Equivale a sumar los `SeasonStats.stats` de `careerBySeason`.
 */
export function careerTotals(rows: readonly SeasonStatRow[]): CareerTotals {
  const stats = sumMatchStats(rows);
  return { stats, ratios: derivedRatios(stats) };
}

/**
 * Métrica elegible para el gráfico de comparación entre temporadas. Cubre los
 * campos de `AggregatedStats` y `DerivedRatios` más usados (incluido el
 * `% titularidad` = `startRate`) y `rating` (que sale de evaluaciones, no de las
 * stats; se lee del campo opcional `rating` de cada temporada).
 */
export type SeasonMetric =
  // Totales (AggregatedStats)
  | 'matches'
  | 'starts'
  | 'minutesPlayed'
  | 'goals'
  | 'assists'
  | 'yellowCards'
  | 'redCards'
  // Ratios (DerivedRatios)
  | 'goalsPerMatch'
  | 'goalsPer90'
  | 'assistsPerMatch'
  | 'minutesPerMatch'
  | 'startRate'
  | 'cardsPerMatch'
  // Externo a las stats (evaluaciones)
  | 'rating';

/**
 * Entrada de `seasonComparison`: un `SeasonStats` con un `rating` medio opcional
 * de la temporada (lo aporta el server desde `evaluations`; el core no lo
 * inventa). `SeasonStats` es asignable a este tipo (rating opcional), así que la
 * salida de `careerBySeason` se puede pasar tal cual para métricas no-rating.
 */
export type SeasonMetricInput = SeasonStats & { rating?: number | null };

const RATIO_KEYS = new Set<SeasonMetric>([
  'goalsPerMatch',
  'goalsPer90',
  'assistsPerMatch',
  'minutesPerMatch',
  'startRate',
  'cardsPerMatch',
]);

function metricValue(
  entry: SeasonMetricInput,
  metric: SeasonMetric
): number | null {
  if (metric === 'rating') return entry.rating ?? null;
  if (RATIO_KEYS.has(metric)) {
    return entry.ratios[metric as keyof DerivedRatios];
  }
  return entry.stats[metric as keyof AggregatedStats];
}

/**
 * Proyecta una serie `{ season, value }` para una métrica concreta, conservando
 * el orden de entrada (descendente si viene de `careerBySeason`). El valor es
 * `null` cuando la métrica no aplica (p.ej. ratio sobre 0 partidos, o `rating`
 * sin valoraciones) — la UI pinta "—" o salta el punto.
 */
export function seasonComparison(
  bySeason: readonly SeasonMetricInput[],
  metric: SeasonMetric
): { season: string; value: number | null }[] {
  return bySeason.map((entry) => ({
    season: entry.season,
    value: metricValue(entry, metric),
  }));
}
