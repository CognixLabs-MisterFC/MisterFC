/**
 * F9.4 / 9.B-2 — Carrera MULTI-TEMPORADA de un jugador. O2-5 C1: la lógica (fetch
 * + agrupado en core) vive en `@misterfc/core` (`getPlayerCareerFromClient`); aquí
 * queda un wrapper que re-exporta los tipos y delega, con firma y comportamiento
 * idénticos.
 */

import {
  getPlayerCareerFromClient,
  type createSupabaseServerClient,
  type PlayerCareer,
  type CareerSeason,
} from '@misterfc/core';

export type { PlayerCareer, CareerSeason };

export async function loadPlayerCareer(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  playerId: string
): Promise<PlayerCareer> {
  return getPlayerCareerFromClient(supabase, playerId);
}
