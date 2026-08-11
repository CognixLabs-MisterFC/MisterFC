/**
 * F9.B-0 — Carga de las stats agregadas de un EQUIPO en su temporada.
 *
 * O2 (badges → core): el FETCH se extrajo a `@misterfc/core`
 * (`getTeamSeasonStatsFromClient`, patrón 1, read-only). Esto es un wrapper de
 * compatibilidad: crea el cliente de servidor (cookies) y delega. Comportamiento
 * IDÉNTICO — misma firma `(teamId, opts?)` para los consumidores existentes. Los
 * tipos se re-exportan desde core para no romper a quien los importa de aquí.
 */

import {
  createSupabaseServerClient,
  getTeamSeasonStatsFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type {
  TeamSeasonStats,
  TeamStatsByType,
  TeamMatchesByType,
  TeamGoalsByType,
} from '@misterfc/core';

export async function loadTeamSeasonStats(
  teamId: string,
  opts?: { viewerIsSpectator?: boolean }
): Promise<Awaited<ReturnType<typeof getTeamSeasonStatsFromClient>>> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getTeamSeasonStatsFromClient(supabase, teamId, opts);
}
