/**
 * F13.10b-1 — Lecturas del editor de Informes de desarrollo (zona staff).
 *
 * El informe se ata a season_id (FK seasons) y al equipo del jugador EN esa
 * temporada (team_members → teams.season = label). El selector de temporada usa
 * la tabla canónica `seasons`; el team_id se resuelve por la pertenencia del
 * jugador en esa temporada.
 */

import {
  createSupabaseServerClient,
  sumMatchStats,
  derivedRatios,
  attendanceBreakdown,
  computeGroupAverages,
  DEVELOPMENT_PERIODS,
  DEVELOPMENT_REPORT_CATALOG,
  type MatchStatRow,
  type AttendanceRow,
} from '@misterfc/core';

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
  review_comment: string | null;
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
    .select('id, title, description, review_comment, status, created_period')
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
    .select('id, title, description, review_comment, status, created_period')
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

// ── Ficha (F13.10 rediseño): stats agregadas de temporada + evolución ───────────

/** Subconjunto de stats ya disponibles en player-profile, para la cabecera. */
export type FichaStats = {
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  startRate: number | null;
  attendancePresentPct: number | null;
  attendanceTotal: number;
};

/** Stats de la temporada (por team.season label), reusando los agregadores de core. */
export async function loadFichaStats(
  supabase: Supa,
  playerId: string,
  seasonLabel: string,
): Promise<FichaStats> {
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(
      'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)',
    )
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel);
  const agg = sumMatchStats((statRows ?? []) as unknown as MatchStatRow[]);
  const ratios = derivedRatios(agg);

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('code, events!inner(type, teams!inner(season))')
    .eq('player_id', playerId)
    .eq('events.type', 'training')
    .eq('events.teams.season', seasonLabel);
  const att = attendanceBreakdown((attRows ?? []) as unknown as AttendanceRow[]);

  return {
    matches: agg.matches,
    minutes: agg.minutesPlayed,
    goals: agg.goals,
    assists: agg.assists,
    yellow: agg.yellowCards,
    red: agg.redCards,
    startRate: ratios.startRate,
    attendancePresentPct: att.presentPct,
    attendanceTotal: att.total,
  };
}

/** Medias de grupo por periodo (los 4 periodos; null donde no hay informe). */
export type PeriodAverages = {
  period: string;
  tecnico: number | null;
  tactico: number | null;
  fisico: number | null;
  actitud: number | null;
};

/** Evolución INDIVIDUAL: medias de los 4 grupos del jugador en cada periodo. */
export async function loadPlayerEvolution(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<PeriodAverages[]> {
  const { data } = await supabase
    .from('development_reports')
    .select('period, scores')
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  const byPeriod = new Map<string, Record<string, number>>();
  for (const r of (data ?? []) as Array<{ period: string; scores: Record<string, number> }>) {
    byPeriod.set(r.period, r.scores ?? {});
  }
  return DEVELOPMENT_PERIODS.map((p) => {
    const scores = byPeriod.get(p);
    if (!scores) return { period: p, tecnico: null, tactico: null, fisico: null, actitud: null };
    const { perGroup } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, scores);
    return {
      period: p,
      tecnico: perGroup.tecnico ?? null,
      tactico: perGroup.tactico ?? null,
      fisico: perGroup.fisico ?? null,
      actitud: perGroup.actitud ?? null,
    };
  });
}
