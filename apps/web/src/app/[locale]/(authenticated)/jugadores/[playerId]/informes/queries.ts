/**
 * F13.10b-1 — Lecturas del editor de Informes de desarrollo (zona staff).
 *
 * El informe se ata a season_id (FK seasons) y al equipo del jugador EN esa
 * temporada (team_members → teams.season = label). El selector de temporada usa
 * la tabla canónica `seasons`; el team_id se resuelve por la pertenencia del
 * jugador en esa temporada.
 */

import { createSupabaseServerClient } from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

export type ClubSeason = { id: string; label: string; status: string };

export type DevelopmentReportRow = {
  id: string;
  period: string;
  visibility: string;
  scores: Record<string, number>;
  comment_overall: string | null;
};

/** Informe individual de un jugador en un periodo concreto (para el editor). */
export type IndividualReport = {
  id: string;
  scores: Record<string, number>;
  comment_overall: string | null;
  visibility: string;
  team_report_id: string | null;
};

/** Valoración de equipo de un periodo concreto (para el editor / bloque fijo). */
export type TeamReport = {
  id: string;
  scores: Record<string, number>;
  comment: string | null;
  visibility: string;
};

/** Temporadas del club (tabla canónica), más recientes primero. */
export async function loadClubSeasons(supabase: Supa, clubId: string): Promise<ClubSeason[]> {
  const { data } = await supabase
    .from('seasons')
    .select('id, label, status')
    .eq('club_id', clubId);
  return ((data ?? []) as ClubSeason[]).sort((a, b) => b.label.localeCompare(a.label));
}

/** Equipo del jugador EN una temporada (por teams.season = label). Prefiere la
 *  pertenencia activa (left_at null); si no, la más reciente de esa temporada. */
export async function resolvePlayerTeamForSeason(
  supabase: Supa,
  playerId: string,
  seasonLabel: string,
): Promise<{ teamId: string; teamName: string } | null> {
  const { data } = await supabase
    .from('team_members')
    .select('team_id, left_at, joined_at, teams!inner(name, season)')
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel)
    .order('joined_at', { ascending: false });
  const rows = (data ?? []) as Array<{
    team_id: string;
    left_at: string | null;
    teams: { name: string; season: string } | null;
  }>;
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.left_at === null) ?? rows[0]!;
  return { teamId: active.team_id, teamName: active.teams?.name ?? '' };
}

export type ObjectiveRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_period?: string;
};

/** Objetivos INDIVIDUALES del jugador en una temporada. */
export async function loadPlayerObjectives(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<ObjectiveRow[]> {
  const { data } = await supabase
    .from('player_objectives')
    .select('id, title, description, status, created_period')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ObjectiveRow[];
}

/** Objetivos GRUPALES del equipo en una temporada (compartidos por el equipo). */
export async function loadTeamObjectives(
  supabase: Supa,
  teamId: string,
  seasonId: string,
): Promise<ObjectiveRow[]> {
  const { data } = await supabase
    .from('team_objectives')
    .select('id, title, description, status')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ObjectiveRow[];
}

/** Informe individual de un jugador en un periodo (para el editor). */
export async function loadIndividualReport(
  supabase: Supa,
  playerId: string,
  seasonId: string,
  period: string,
): Promise<IndividualReport | null> {
  const { data } = await supabase
    .from('development_reports')
    .select('id, scores, comment_overall, visibility, team_report_id')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return (data as unknown as IndividualReport | null) ?? null;
}

/** Valoración de equipo de un periodo (para el editor de equipo y el bloque fijo). */
export async function loadTeamReport(
  supabase: Supa,
  teamId: string,
  seasonId: string,
  period: string,
): Promise<TeamReport | null> {
  const { data } = await supabase
    .from('team_development_reports')
    .select('id, scores, comment, visibility')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return (data as unknown as TeamReport | null) ?? null;
}

/** Informes del jugador en una temporada, indexados por periodo. */
export async function loadReportsByPeriod(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<Map<string, DevelopmentReportRow>> {
  const { data } = await supabase
    .from('development_reports')
    .select('id, period, visibility, scores, comment_overall')
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  const map = new Map<string, DevelopmentReportRow>();
  for (const r of (data ?? []) as unknown as DevelopmentReportRow[]) map.set(r.period, r);
  return map;
}
