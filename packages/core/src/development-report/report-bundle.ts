import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { DEVELOPMENT_PERIODS } from './development-report';
import {
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadPlayerEvolution,
  loadTeamEvolution,
  type ObjectiveRow,
  type FichaStats,
  type PeriodAverages,
  type TeamPeriodAverages,
} from './report-queries';

/**
 * O2-5 C1 — Composite del INFORME DE DESARROLLO del hijo (Mi informe, SOLO
 * LECTURA), extraído de la orquestación inline de `apps/web/.../mi-informe/page.tsx`.
 * Resuelve temporadas + periodos publicados (RLS → solo los del propio jugador) y,
 * para el periodo elegido, ensambla el informe llamando a las hojas de core. El
 * caller pinta (web: ReportFichaView + firma la foto; native: su vista). NO firma
 * la foto (Storage server-only): devuelve `photoPath`.
 */
type DbClient = SupabaseClient<Database>;

export type ReportIdentity = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  dorsal: number | null;
  positionMain: string | null;
  positionsSecondary: string[];
  foot: string | null;
  photoPath: string | null;
};

export type PlayerDevelopmentReport = {
  period: string;
  teamName: string;
  identity: ReportIdentity;
  scores: Record<string, number>;
  commentOverall: string | null;
  teamReport: { scores: Record<string, number>; comment: string | null } | null;
  playerObjectives: ObjectiveRow[];
  teamObjectives: ObjectiveRow[];
  fichaStats: FichaStats;
  evolution: PeriodAverages[];
  teamEvolution: TeamPeriodAverages[];
};

export type PlayerReportBundle = {
  seasons: string[];
  activeSeason: string | null;
  /** Periodos con informe PUBLICADO en la temporada activa (RLS → solo suyos). */
  periods: string[];
  report: PlayerDevelopmentReport | null;
};

export async function getPlayerReportBundleFromClient(
  supabase: DbClient,
  clubId: string,
  playerId: string,
  opts?: { season?: string | null; period?: string | null }
): Promise<PlayerReportBundle> {
  // 1) Temporadas de la trayectoria (selector + default).
  const { data: history } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(season)')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  type HistTeam = { season: string } | null;
  const seasonsSet = new Set<string>();
  let activeSeasonFromHistory: string | null = null;
  for (const h of history ?? []) {
    const tm = (h.teams ?? null) as HistTeam;
    const s = tm?.season;
    if (s) {
      seasonsSet.add(s);
      if (h.left_at === null) activeSeasonFromHistory = s;
    }
  }
  const seasons = Array.from(seasonsSet).sort((a, b) => b.localeCompare(a));
  const requestedSeason = opts?.season ?? null;
  const activeSeason =
    (requestedSeason && seasons.includes(requestedSeason) ? requestedSeason : null) ??
    activeSeasonFromHistory ??
    seasons[0] ??
    null;

  if (!activeSeason) return { seasons, activeSeason: null, periods: [], report: null };

  // 2) season_id (tabla canónica) + periodos PUBLICADOS del jugador (RLS → suyos).
  const { data: seasonRow } = await supabase
    .from('seasons')
    .select('id')
    .eq('club_id', clubId)
    .eq('label', activeSeason)
    .maybeSingle();
  const seasonId = (seasonRow?.id as string | undefined) ?? null;
  if (!seasonId) return { seasons, activeSeason, periods: [], report: null };

  const { data: pubRows } = await supabase
    .from('development_reports')
    .select('period')
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  const pubSet = new Set((pubRows ?? []).map((r) => r.period as string));
  const periods: string[] = DEVELOPMENT_PERIODS.filter((p) => pubSet.has(p));
  const requestedPeriod = opts?.period ?? null;
  const selPeriod =
    requestedPeriod && periods.includes(requestedPeriod) ? requestedPeriod : periods[0];
  if (!selPeriod) return { seasons, activeSeason, periods, report: null };

  // 3) Informe del periodo: identidad + equipo + hojas + valoración de equipo.
  const { data: pl } = await supabase
    .from('players')
    .select(
      'first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url',
    )
    .eq('id', playerId)
    .maybeSingle();
  const identity: ReportIdentity = {
    firstName: pl?.first_name ?? null,
    lastName: pl?.last_name ?? null,
    dateOfBirth: pl?.date_of_birth ?? null,
    dorsal: pl?.dorsal ?? null,
    positionMain: pl?.position_main ?? null,
    positionsSecondary: (pl?.positions_secondary ?? []) as string[],
    foot: pl?.foot ?? null,
    photoPath: pl?.photo_url ?? null,
  };

  const team = await resolvePlayerTeamForSeason(supabase, playerId, activeSeason);
  const [report, playerObjectives, teamObjectives, fichaStats, evolution, teamEvolution] =
    await Promise.all([
      loadIndividualReport(supabase, playerId, seasonId, selPeriod),
      loadPlayerObjectives(supabase, playerId, seasonId),
      team ? loadTeamObjectives(supabase, team.teamId, seasonId) : Promise.resolve([]),
      loadFichaStats(supabase, playerId, activeSeason, team?.teamId ?? null),
      loadPlayerEvolution(supabase, playerId, seasonId),
      team ? loadTeamEvolution(supabase, team.teamId, seasonId) : Promise.resolve([]),
    ]);

  let teamReport: { scores: Record<string, number>; comment: string | null } | null = null;
  if (report?.team_report_id) {
    const { data: tr } = await supabase
      .from('team_development_reports')
      .select('scores, comment')
      .eq('id', report.team_report_id)
      .maybeSingle();
    if (tr) {
      teamReport = {
        scores: (tr.scores as Record<string, number>) ?? {},
        comment: (tr.comment as string | null) ?? null,
      };
    }
  }

  return {
    seasons,
    activeSeason,
    periods,
    report: {
      period: selPeriod,
      teamName: team?.teamName ?? '',
      identity,
      scores: report?.scores ?? {},
      commentOverall: report?.comment_overall ?? null,
      teamReport,
      playerObjectives,
      teamObjectives,
      fichaStats,
      evolution,
      teamEvolution,
    },
  };
}
