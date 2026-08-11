/**
 * F9.6 / 9.B-5 — Ensamblaje de las badges de un jugador.
 *
 * O2 (badges → core): el FETCH se extrajo a `@misterfc/core`
 * (`getPlayerBadgesFromClient`, patrón 1, read-only). Esto es un wrapper de
 * compatibilidad: misma firma `(supabase, { playerId, clubId, careerMatches })` y
 * comportamiento IDÉNTICO. El cálculo sigue en `core/player-profile/badges.ts`.
 */

import {
  getPlayerBadgesFromClient,
  type Badge,
  type LoadPlayerBadgesArgs,
  type createSupabaseServerClient,
} from '@misterfc/core';

export type { LoadPlayerBadgesArgs };

type Supa = ReturnType<typeof createSupabaseServerClient>;

export function loadPlayerBadges(
  supabase: Supa,
  args: LoadPlayerBadgesArgs
): Promise<Badge[]> {
  return getPlayerBadgesFromClient(supabase, args);
}
