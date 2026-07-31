import {
  getSportingNamesFromClient,
  type createSupabaseServerClient,
  type SportingName,
} from '@misterfc/core';

// O2-5 B2 — la resolución de nombres deportivos vive en `@misterfc/core`
// (`getSportingNamesFromClient`); web re-exporta el tipo y delega. La usan el
// detalle de directo (extraído a core) y las estadísticas de equipo (vecina, sin
// cambios).
export type { SportingName };

/**
 * F14C-4b — Resuelve nombre/dorsal de jugadores desde `players_sporting`. Wrapper
 * de `getSportingNamesFromClient` (core), comportamiento idéntico.
 */
export async function loadSportingNames(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  playerIds: (string | null | undefined)[]
): Promise<Map<string, SportingName>> {
  return getSportingNamesFromClient(supabase, playerIds);
}
