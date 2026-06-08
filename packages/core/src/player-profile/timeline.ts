/**
 * F9.3 — Serie de evolución intra-temporada de la valoración (PURO, sin red ni DOM).
 *
 * Spec 9.0 §7: el server lee los partidos del jugador en la temporada (orden por
 * `events.starts_at`) con su nota INDIVIDUAL (`evaluations.rating`) y, como
 * contexto, la COLECTIVA del equipo (`team_evaluations.rating`) de ese mismo
 * partido. Aquí solo ORDENAMOS cronológicamente y normalizamos: el cliente
 * (recharts) pinta. Un partido sin nota individual deja `rating = null` → la línea
 * muestra un HUECO en ese punto (no se interpola ni se pone 0).
 */

/** Un partido con sus dos notas (individual + colectiva), ambas opcionales. */
export interface MatchRatingInput {
  eventId: string;
  /** ISO timestamp de `events.starts_at` (clave de orden cronológico). */
  startsAt: string;
  /** Etiqueta del partido (rival si existe, si no el título del evento). */
  label: string;
  /** Nota individual del jugador (1-10) o `null` si no fue valorado. */
  rating: number | null;
  /** Nota colectiva del equipo (1-10) o `null` si no hay. */
  teamRating: number | null;
}

export type RatingTimelinePoint = MatchRatingInput;

/**
 * Ordena los partidos cronológicamente (ascendente por `startsAt`) para la serie
 * del gráfico. No interpola ni rellena: conserva los `null` como huecos. No muta
 * la entrada (devuelve un array nuevo).
 */
export function ratingTimeline(
  rows: readonly MatchRatingInput[]
): RatingTimelinePoint[] {
  return [...rows].sort((a, b) => {
    if (a.startsAt < b.startsAt) return -1;
    if (a.startsAt > b.startsAt) return 1;
    return 0;
  });
}

/** TRUE si la serie tiene al menos una nota (individual o colectiva) que pintar. */
export function timelineHasRatings(points: readonly RatingTimelinePoint[]): boolean {
  return points.some((p) => p.rating != null || p.teamRating != null);
}
