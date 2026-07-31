/**
 * F14E-6 — Plantilla deportiva del jugador: roster de UN equipo con stats
 * agregadas por jugador, SOLO-LECTURA.
 *
 * O2-5 D1 — el FETCH se extrajo a core (`getTeamRosterStatsFromClient`, que reutiliza
 * `aggregateTeamStats`). Esto es un wrapper de compatibilidad: misma firma y
 * comportamiento (RLS `match_player_stats_select_teammate`; identidad desde
 * `players_sporting`, sin datos personales).
 */

import {
  createSupabaseServerClient,
  getTeamRosterStatsFromClient,
  type RosterStatRow,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type { RosterStatRow } from '@misterfc/core';

export async function loadTeamRosterStats(
  teamId: string,
): Promise<RosterStatRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getTeamRosterStatsFromClient(supabase, teamId);
}
