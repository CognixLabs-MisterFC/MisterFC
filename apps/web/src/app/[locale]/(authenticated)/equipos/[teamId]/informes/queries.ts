/**
 * F13.10 — Lecturas de la pantalla de Informes a nivel EQUIPO. El equipo está
 * atado a una temporada (teams.season label); el season_id se resuelve en la
 * tabla canónica `seasons`. El estado de cada fila se calcula con reportStatus
 * (core) sobre las puntuaciones; no es un campo persistido.
 */

import { createSupabaseServerClient, formatPlayerName } from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

/** season_id de una temporada del club por su label (null si no está en seasons). */
export async function resolveSeasonId(
  supabase: Supa,
  clubId: string,
  label: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('seasons')
    .select('id')
    .eq('club_id', clubId)
    .eq('label', label)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export type RosterMember = { playerId: string; name: string; dorsal: number | null };

/** Jugadores activos del equipo (team_members con left_at null), ordenados. */
export async function loadActiveRoster(supabase: Supa, teamId: string): Promise<RosterMember[]> {
  const { data } = await supabase
    .from('team_members')
    .select('dorsal_in_team, players!inner(id, first_name, last_name, dorsal)')
    .eq('team_id', teamId)
    .is('left_at', null);
  const rows = (data ?? []) as unknown as Array<{
    dorsal_in_team: number | null;
    players: { id: string; first_name: string; last_name: string; dorsal: number | null };
  }>;
  return rows
    .map((r) => ({
      playerId: r.players.id,
      name: formatPlayerName(r.players.first_name, r.players.last_name),
      dorsal: r.dorsal_in_team ?? r.players.dorsal,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** scores de la valoración de equipo de un periodo (null si no existe). */
export async function loadTeamReportScores(
  supabase: Supa,
  teamId: string,
  seasonId: string,
  period: string,
): Promise<Record<string, number> | null> {
  const { data } = await supabase
    .from('team_development_reports')
    .select('scores')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return data ? ((data.scores as Record<string, number>) ?? {}) : null;
}

/** scores de los informes individuales del equipo en un periodo, por jugador. */
export async function loadPlayerScoresByPlayer(
  supabase: Supa,
  teamId: string,
  seasonId: string,
  period: string,
): Promise<Map<string, Record<string, number>>> {
  const { data } = await supabase
    .from('development_reports')
    .select('player_id, scores')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('period', period);
  const map = new Map<string, Record<string, number>>();
  for (const r of (data ?? []) as Array<{ player_id: string; scores: Record<string, number> }>) {
    map.set(r.player_id, r.scores ?? {});
  }
  return map;
}
