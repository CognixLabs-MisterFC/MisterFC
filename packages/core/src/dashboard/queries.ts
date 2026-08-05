/**
 * O2-11b — Loaders del DASHBOARD EJECUTIVO extraídos a core (FromClient).
 *
 * Portan tal cual la lógica de `apps/web/.../dashboard/queries.ts` (F10.*): UNA
 * consulta por tabla con `IN (teamIds)` (sin N+1) y la agregación DELEGADA en los
 * helpers PUROS de core (`aggregateClubStats`, `aggregateTeamResults`,
 * `clubAttendanceAgg`, `clubRankings`, `lowAttendanceAlerts`, `inactivePlayers`) —
 * que ya viven en `player-profile/club.ts` y NO se reimplementan.
 *
 * Cambios respecto a la web: reciben el `SupabaseClient` (para que web-cookies o
 * native-anon lo inyecten) y el reporte de errores de Sentry se sustituye por un
 * callback opcional `onError` (core no depende de `@sentry/nextjs`; el wrapper web
 * inyecta Sentry para conservar el comportamiento). RLS heredada (admin/coord ven
 * su club) — sin políticas nuevas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  aggregateClubStats,
  aggregateTeamResults,
  clubAttendanceAgg,
  clubRankings,
  lowAttendanceAlerts,
  inactivePlayers,
  type ClubTeam,
  type ClubMember,
  type ClubCensus,
  type MatchResultRow,
  type TeamResults,
  type ClubAttendanceRow,
  type ClubAttendanceAgg,
  type CategoryStatRow,
  type CategoryEvalRow,
  type CategoryRankings,
} from '../player-profile/club';
import {
  activeSeasonLabel,
  categoryKindOrdinal,
  currentSeason,
} from '../schemas/club-structure';
import {
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
} from '../development-report/development-report';
import { formatPlayerName } from '../utils/name';

type DbClient = SupabaseClient<Database>;

/** Reporte de error inyectable (el wrapper web lo enlaza a Sentry). */
export type DashboardErrorContext = { clubId: string; season: string };
export type DashboardOpts = {
  onError?: (error: unknown, ctx: DashboardErrorContext) => void;
};

/** Contexto de temporada del club + los equipos sobre los que opera el dashboard. */
export interface DashboardSeasonContext {
  clubId: string;
  activeSeason: string;
  previousSeason: string | null;
  teamIds: string[];
}

export interface ClubDashboardBase {
  season: DashboardSeasonContext;
  census: ClubCensus;
  previousCensus: ClubCensus | null;
}

type TeamRow = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  categories: { name: string; kind: string | null };
};

type MemberRow = {
  player_id: string;
  team_id: string;
};

/**
 * Censo de UNA temporada: equipos (una query, categoría embebida) + roster activo
 * (una query con `IN (teamIds)`). Dos lecturas, ninguna por-equipo.
 */
async function loadSeasonCensus(
  supabase: DbClient,
  clubId: string,
  season: string,
  opts?: DashboardOpts,
): Promise<{ census: ClubCensus; teamIds: string[] }> {
  const { data: rawTeams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, color, category_id, categories!inner(name, kind)')
    .eq('club_id', clubId)
    .eq('season', season);
  // El error NO puede desaparecer sin rastro; se delega en onError (Sentry en web).
  // La UI degrada a censo vacío, no revienta.
  if (teamsError) {
    opts?.onError?.(teamsError, { clubId, season });
  }
  const teamRows = (rawTeams ?? []) as unknown as TeamRow[];

  const teams: ClubTeam[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    categoryId: t.category_id,
    categoryName: t.categories.name,
    categoryOrder: categoryKindOrdinal(t.categories.kind),
  }));
  const teamIds = teams.map((t) => t.id);

  let members: ClubMember[] = [];
  if (teamIds.length > 0) {
    const { data: rawMembers } = await supabase
      .from('team_members')
      .select('player_id, team_id')
      .in('team_id', teamIds)
      .is('left_at', null);
    members = ((rawMembers ?? []) as unknown as MemberRow[]).map((m) => ({
      playerId: m.player_id,
      teamId: m.team_id,
    }));
  }

  return { census: aggregateClubStats(teams, members), teamIds };
}

/**
 * Carga base: temporada activa + anterior y el censo de ambas (la anterior solo si
 * existe). Lecturas: 1 (seasons) + 2 (activa) + 2 (anterior, si hay).
 */
export async function getClubDashboardBaseFromClient(
  supabase: DbClient,
  clubId: string,
  opts?: DashboardOpts,
): Promise<ClubDashboardBase> {
  const { data: seasonRows } = await supabase
    .from('seasons')
    .select('label, status')
    .eq('club_id', clubId);
  const seasons = seasonRows ?? [];
  const activeSeason = activeSeasonLabel(seasons) ?? currentSeason();
  const previousSeason =
    seasons
      .map((s) => s.label)
      .filter((label) => label < activeSeason)
      .sort()
      .at(-1) ?? null;

  const active = await loadSeasonCensus(supabase, clubId, activeSeason, opts);
  const previousCensus = previousSeason
    ? (await loadSeasonCensus(supabase, clubId, previousSeason, opts)).census
    : null;

  return {
    season: { clubId, activeSeason, previousSeason, teamIds: active.teamIds },
    census: active.census,
    previousCensus,
  };
}

/** Tipos de evento que cuentan como "partido" (spec 10.0 §4.2; D2). */
const MATCH_EVENT_TYPES = ['match', 'friendly', 'tournament'] as const;

type MatchStateRow = {
  status: MatchResultRow['status'];
  goals_for: number | null;
  goals_against: number | null;
  events: { team_id: string | null };
};

/** F10.3 — Resultados acumulados por equipo (una query; D2 la aplica el agregador). */
export async function getClubResultsFromClient(
  supabase: DbClient,
  teamIds: readonly string[],
): Promise<TeamResults[]> {
  if (teamIds.length === 0) return [];

  const { data } = await supabase
    .from('match_state')
    .select('status, goals_for, goals_against, events!inner(team_id, type)')
    .in('events.team_id', teamIds as string[])
    .in('events.type', MATCH_EVENT_TYPES as unknown as string[]);

  const rows: MatchResultRow[] = ((data ?? []) as unknown as MatchStateRow[])
    .filter((r) => r.events.team_id != null)
    .map((r) => ({
      teamId: r.events.team_id as string,
      status: r.status,
      goalsFor: r.goals_for,
      goalsAgainst: r.goals_against,
    }));

  return aggregateTeamResults(teamIds, rows);
}

type AttendanceJoinRow = {
  player_id: string;
  code: ClubAttendanceRow['code'];
  event_id: string;
  events: { team_id: string | null; starts_at: string };
};

export interface ClubAttendanceData {
  agg: ClubAttendanceAgg;
  playerNames: Record<string, string>;
  playerTeamId: Record<string, string>;
}

/** F10.4 — Asistencia a entrenos (una query principal; `clubAttendanceAgg` agrega). */
export async function getClubAttendanceFromClient(
  supabase: DbClient,
  teamIds: readonly string[],
): Promise<ClubAttendanceData> {
  const empty: ClubAttendanceData = {
    agg: clubAttendanceAgg([]),
    playerNames: {},
    playerTeamId: {},
  };
  if (teamIds.length === 0) return empty;

  const { data } = await supabase
    .from('training_attendance')
    .select('player_id, code, event_id, events!inner(team_id, type, starts_at)')
    .eq('events.type', 'training')
    .is('events.cancelled_at', null)
    .in('events.team_id', teamIds as string[]);

  const joinRows = ((data ?? []) as unknown as AttendanceJoinRow[]).filter(
    (r) => r.events.team_id != null,
  );

  const rows: ClubAttendanceRow[] = joinRows.map((r) => ({
    eventId: r.event_id,
    eventDate: r.events.starts_at,
    teamId: r.events.team_id as string,
    playerId: r.player_id,
    code: r.code,
  }));

  const agg = clubAttendanceAgg(rows);

  // playerTeamId: para cada jugador, el equipo donde más registros tiene.
  const teamCountByPlayer = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = teamCountByPlayer.get(r.playerId) ?? new Map<string, number>();
    m.set(r.teamId, (m.get(r.teamId) ?? 0) + 1);
    teamCountByPlayer.set(r.playerId, m);
  }
  const playerTeamId: Record<string, string> = {};
  for (const [playerId, counts] of teamCountByPlayer) {
    let best = '';
    let bestN = -1;
    for (const [teamId, n] of counts) {
      if (n > bestN) {
        best = teamId;
        bestN = n;
      }
    }
    playerTeamId[playerId] = best;
  }

  // Nombres de los jugadores del ranking (una query con IN).
  const playerIds = agg.playerRanking.map((p) => p.playerId);
  const playerNames: Record<string, string> = {};
  if (playerIds.length > 0) {
    const { data: players } = await supabase
      .from('players')
      .select('id, first_name, last_name')
      .in('id', playerIds);
    for (const p of (players ?? []) as unknown as {
      id: string;
      first_name: string;
      last_name: string | null;
    }[]) {
      playerNames[p.id] = formatPlayerName(p.first_name, p.last_name);
    }
  }

  return { agg, playerNames, playerTeamId };
}

type TeamCategoryRow = {
  id: string;
  category_id: string;
  categories: { name: string };
};
type StatGoalsRow = { player_id: string; goals: number; team_id: string };
type EvalRow = {
  player_id: string;
  rating: number | null;
  is_mvp: boolean;
  team_id: string;
};

export interface ClubRankingsData {
  byCategory: CategoryRankings[];
  playerNames: Record<string, string>;
}

/** F10.6 — Rankings POR CATEGORÍA (D5); `clubRankings` agrega (top-N con empates). */
export async function getClubRankingsFromClient(
  supabase: DbClient,
  teamIds: readonly string[],
): Promise<ClubRankingsData> {
  if (teamIds.length === 0) return { byCategory: [], playerNames: {} };

  const { data: rawTeams } = await supabase
    .from('teams')
    .select('id, category_id, categories!inner(name)')
    .in('id', teamIds as string[]);
  const teamCategory = new Map<string, { id: string; name: string }>();
  for (const t of (rawTeams ?? []) as unknown as TeamCategoryRow[]) {
    teamCategory.set(t.id, { id: t.category_id, name: t.categories.name });
  }

  const [{ data: rawStats }, { data: rawEvals }] = await Promise.all([
    supabase
      .from('match_player_stats')
      .select('player_id, goals, team_id')
      .in('team_id', teamIds as string[]),
    supabase
      .from('evaluations')
      .select('player_id, rating, is_mvp, team_id')
      .in('team_id', teamIds as string[]),
  ]);

  const statRows: CategoryStatRow[] = [];
  for (const r of (rawStats ?? []) as unknown as StatGoalsRow[]) {
    const cat = teamCategory.get(r.team_id);
    if (!cat) continue;
    statRows.push({
      categoryId: cat.id,
      categoryName: cat.name,
      playerId: r.player_id,
      goals: r.goals,
    });
  }

  const evalRows: CategoryEvalRow[] = [];
  for (const r of (rawEvals ?? []) as unknown as EvalRow[]) {
    const cat = teamCategory.get(r.team_id);
    if (!cat) continue;
    evalRows.push({
      categoryId: cat.id,
      categoryName: cat.name,
      playerId: r.player_id,
      rating: r.rating,
      isMvp: r.is_mvp,
    });
  }

  const byCategory = clubRankings(statRows, evalRows);

  const ids = new Set<string>();
  for (const c of byCategory) {
    for (const e of c.topScorers) ids.add(e.playerId);
    for (const e of c.topMvps) ids.add(e.playerId);
    for (const e of c.bestAvgRating) ids.add(e.playerId);
  }
  const playerNames: Record<string, string> = {};
  if (ids.size > 0) {
    const { data: players } = await supabase
      .from('players')
      .select('id, first_name, last_name')
      .in('id', Array.from(ids));
    for (const p of (players ?? []) as unknown as {
      id: string;
      first_name: string;
      last_name: string | null;
    }[]) {
      playerNames[p.id] = formatPlayerName(p.first_name, p.last_name);
    }
  }

  return { byCategory, playerNames };
}

type RosterIdentityRow = {
  player_id: string;
  team_id: string;
  players: { first_name: string; last_name: string | null };
};
type AttendanceAlertRow = {
  player_id: string;
  code: ClubAttendanceRow['code'];
  event_id: string;
  events: { team_id: string | null; starts_at: string };
};

export interface LowAttendanceAlertItem {
  playerId: string;
  name: string;
  teamId: string;
  presentPct: number;
  sessions: number;
}
export interface InactiveAlertItem {
  playerId: string;
  name: string;
  teamId: string;
}
export interface ClubAlertsData {
  lowAttendance: LowAttendanceAlertItem[];
  inactive: InactiveAlertItem[];
}

/** F10.5 — Alertas del club (D3 baja asistencia + D4 inactivos). */
export async function getClubAlertsFromClient(
  supabase: DbClient,
  teamIds: readonly string[],
): Promise<ClubAlertsData> {
  if (teamIds.length === 0) return { lowAttendance: [], inactive: [] };

  const { data: rawRoster } = await supabase
    .from('team_members')
    .select('player_id, team_id, players!inner(first_name, last_name)')
    .in('team_id', teamIds as string[])
    .is('left_at', null);
  const rosterRows = (rawRoster ?? []) as unknown as RosterIdentityRow[];

  const identity = new Map<string, { name: string; teamId: string }>();
  const rosterPlayerIds: string[] = [];
  for (const r of rosterRows) {
    rosterPlayerIds.push(r.player_id);
    if (!identity.has(r.player_id)) {
      identity.set(r.player_id, {
        name: formatPlayerName(r.players.first_name, r.players.last_name),
        teamId: r.team_id,
      });
    }
  }
  const rosterSet = new Set(rosterPlayerIds);

  const [{ data: rawAtt }, { data: rawStats }] = await Promise.all([
    supabase
      .from('training_attendance')
      .select('player_id, code, event_id, events!inner(team_id, type, starts_at)')
      .eq('events.type', 'training')
      .is('events.cancelled_at', null)
      .in('events.team_id', teamIds as string[]),
    supabase
      .from('match_player_stats')
      .select('player_id')
      .in('team_id', teamIds as string[]),
  ]);

  const attRows: ClubAttendanceRow[] = ((rawAtt ?? []) as unknown as AttendanceAlertRow[])
    .filter((r) => r.events.team_id != null)
    .map((r) => ({
      eventId: r.event_id,
      eventDate: r.events.starts_at,
      teamId: r.events.team_id as string,
      playerId: r.player_id,
      code: r.code,
    }));
  const agg = clubAttendanceAgg(attRows);
  const withAttendance = new Set(agg.playerRanking.map((p) => p.playerId));
  const withMatchStats = new Set(
    ((rawStats ?? []) as unknown as { player_id: string }[]).map((r) => r.player_id),
  );

  const samples = agg.playerRanking
    .filter((p) => rosterSet.has(p.playerId))
    .map((p) => ({
      playerId: p.playerId,
      presentPct: p.breakdown.presentPct,
      sessions: p.breakdown.total,
    }));
  const lowAttendance: LowAttendanceAlertItem[] = lowAttendanceAlerts(samples).map((a) => ({
    playerId: a.playerId,
    name: identity.get(a.playerId)?.name ?? '—',
    teamId: identity.get(a.playerId)?.teamId ?? '',
    presentPct: a.presentPct,
    sessions: a.sessions,
  }));

  const inactive: InactiveAlertItem[] = inactivePlayers(
    rosterPlayerIds,
    withMatchStats,
    withAttendance,
  ).map((id) => ({
    playerId: id,
    name: identity.get(id)?.name ?? '—',
    teamId: identity.get(id)?.teamId ?? '',
  }));

  return { lowAttendance, inactive };
}

export interface CampaignDeadlineAlert {
  period: string;
  dueDate: string;
  pending: number;
  pendingTeams: number;
}

/** F13.10g-GD — Campañas lanzadas con informes pendientes (aviso "por vencer"). */
export async function getCampaignDeadlineAlertsFromClient(
  supabase: DbClient,
  clubId: string,
  teamIds: readonly string[],
): Promise<CampaignDeadlineAlert[]> {
  if (teamIds.length === 0) return [];

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return [];
  const seasonId = season.id as string;

  const { data: campaignRows } = await supabase
    .from('assessment_campaigns')
    .select('period, due_date')
    .eq('season_id', seasonId)
    .eq('status', 'launched');
  const launched = ((campaignRows ?? []) as Array<{ period: string; due_date: string | null }>)
    .filter((c) => c.due_date)
    .map((c) => ({ period: c.period, dueDate: c.due_date as string }));
  if (launched.length === 0) return [];

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('player_id, team_id')
    .in('team_id', teamIds as string[])
    .is('left_at', null);
  const rosterByTeam = new Map<string, Set<string>>();
  const rosterIds = new Set<string>();
  for (const r of (rosterRows ?? []) as Array<{ player_id: string; team_id: string }>) {
    rosterIds.add(r.player_id);
    const set = rosterByTeam.get(r.team_id) ?? new Set<string>();
    set.add(r.player_id);
    rosterByTeam.set(r.team_id, set);
  }
  if (rosterIds.size === 0) return [];

  const periods = launched.map((l) => l.period);
  const { data: reportRows } = await supabase
    .from('development_reports')
    .select('player_id, period, scores')
    .eq('season_id', seasonId)
    .in('team_id', teamIds as string[])
    .in('period', periods);
  const completedByPeriod = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    player_id: string;
    period: string;
    scores: Record<string, number>;
  }>) {
    if (
      rosterIds.has(r.player_id) &&
      reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed'
    ) {
      const set = completedByPeriod.get(r.period) ?? new Set<string>();
      set.add(r.player_id);
      completedByPeriod.set(r.period, set);
    }
  }

  return launched
    .map((l) => {
      const completed = completedByPeriod.get(l.period) ?? new Set<string>();
      let pending = 0;
      for (const pid of rosterIds) if (!completed.has(pid)) pending++;
      let pendingTeams = 0;
      for (const members of rosterByTeam.values()) {
        let teamPending = false;
        for (const pid of members)
          if (!completed.has(pid)) {
            teamPending = true;
            break;
          }
        if (teamPending) pendingTeams++;
      }
      return { period: l.period, dueDate: l.dueDate, pending, pendingTeams };
    })
    .filter((a) => a.pending > 0);
}
