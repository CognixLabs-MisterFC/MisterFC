import {
  getPlayerBadgesFromClient,
  getPlayerCareerFromClient,
  type Badge,
} from '@misterfc/core';
import type { NativeDbClient } from '@/data/client-data';

/**
 * LOGROS de un jugador. Son dos lecturas encadenadas —la carrera da los partidos
 * totales, que es uno de los umbrales del catálogo— y por eso estaban copiadas en
 * "Mi ficha"; la ficha del cuerpo técnico sería la segunda copia.
 *
 * Se calculan CON el roster del equipo (son comparativos: pichichi del equipo, el
 * que más juega…), igual que en la web, y SIEMPRE sobre la temporada activa: no
 * dependen del selector de temporada, así que su clave de caché tampoco lo lleva.
 *
 * RLS directa: si el club no expone valoraciones, el motor de core no emite las
 * medallas que dependen de la nota. No hay nada que decidir aquí.
 */
export async function loadFichaBadges(
  sb: NativeDbClient,
  playerId: string | null,
  clubId: string | null,
): Promise<Badge[]> {
  if (!playerId || !clubId) return [];
  const career = await getPlayerCareerFromClient(sb, playerId);
  return getPlayerBadgesFromClient(sb, {
    playerId,
    clubId,
    careerMatches: career.totals.stats.matches,
  });
}
