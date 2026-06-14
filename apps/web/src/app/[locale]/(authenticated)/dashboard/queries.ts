/**
 * F10.1/10.2 — Loader BASE del dashboard ejecutivo del club.
 *
 * Establece el patrón de carga club-wide de F10 (spec
 * [10.0](../../../../../../docs/specs/10.0-dashboard-ejecutivo.md), DT2): UNA
 * consulta por tabla con `IN (teamIds)` (sin N+1: nunca se itera equipo-a-equipo
 * llamando `loadTeamSeasonStats`), y la agregación se DELEGA en los helpers puros
 * de `@misterfc/core` (`aggregateClubStats`). RLS heredada (admin/coord ven todo
 * su club por las policies existentes) — sin políticas nuevas.
 *
 * 10.2 añade la comparativa de plantilla con la temporada ANTERIOR (D1): se
 * calcula su censo con el MISMO patrón (teams + team_members, dos lecturas, sin
 * iterar por equipo). 10.3 añade los resultados acumulados por equipo (D2). El
 * resto de secciones (asistencia, alertas, rankings) añadirán su carga en
 * 10.4–10.6 reusando `teamIds`.
 */

import {
  aggregateClubStats,
  aggregateTeamResults,
  clubAttendanceAgg,
  clubRankings,
  formatPlayerName,
  activeSeasonLabel,
  currentSeason,
  createSupabaseServerClient,
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
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type Supabase = ReturnType<typeof createSupabaseServerClient>;

/** Contexto de temporada del club + los equipos sobre los que opera el dashboard. */
export interface DashboardSeasonContext {
  clubId: string;
  /** Temporada activa del club (C5: `seasons.status='active'`). */
  activeSeason: string;
  /**
   * Temporada inmediatamente anterior (mayor label < activa), o `null` si es la
   * primera temporada del club (no hay comparativa).
   */
  previousSeason: string | null;
  /** IDs de los equipos de la temporada activa (clave del patrón `IN (teamIds)`). */
  teamIds: string[];
}

export interface ClubDashboardBase {
  season: DashboardSeasonContext;
  /** Censo de la temporada activa (`aggregateClubStats`). */
  census: ClubCensus;
  /** Censo de la temporada anterior para la comparativa (D1); `null` si no hay. */
  previousCensus: ClubCensus | null;
}

type TeamRow = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  categories: { name: string; order_idx: number };
};

type MemberRow = {
  player_id: string;
  team_id: string;
};

/**
 * Censo de UNA temporada: equipos de la temporada (una query, categoría embebida)
 * + roster activo de esos equipos (una query con `IN (teamIds)`). Dos lecturas,
 * ninguna por-equipo. Devuelve el censo agregado + los `teamIds` (los necesita la
 * activa para 10.3–10.6).
 */
async function loadSeasonCensus(
  supabase: Supabase,
  clubId: string,
  season: string,
): Promise<{ census: ClubCensus; teamIds: string[] }> {
  // Equipos de la temporada (categoría embebida para nombre + order_idx).
  const { data: rawTeams } = await supabase
    .from('teams')
    .select('id, name, color, category_id, categories!inner(name, order_idx)')
    .eq('club_id', clubId)
    .eq('season', season);
  const teamRows = (rawTeams ?? []) as unknown as TeamRow[];

  const teams: ClubTeam[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    categoryId: t.category_id,
    categoryName: t.categories.name,
    categoryOrder: t.categories.order_idx,
  }));
  const teamIds = teams.map((t) => t.id);

  // Roster ACTIVO de esos equipos (una query con IN; left_at IS NULL = activo).
  // Si no hay equipos, se evita la query.
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
 * Carga base del dashboard: resuelve temporada activa + anterior y el censo de
 * ambas (la anterior solo si existe). Lecturas totales: 1 (seasons) + 2 (activa)
 * + 2 (anterior, si la hay) — todas constantes, ninguna por-equipo.
 */
export async function loadClubDashboardBase(clubId: string): Promise<ClubDashboardBase> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Temporadas del club → activa (fuente de verdad C5) + anterior (mayor label
  // estrictamente menor que la activa).
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

  const active = await loadSeasonCensus(supabase, clubId, activeSeason);
  const previousCensus = previousSeason
    ? (await loadSeasonCensus(supabase, clubId, previousSeason)).census
    : null;

  return {
    season: {
      clubId,
      activeSeason,
      previousSeason,
      teamIds: active.teamIds,
    },
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

/**
 * F10.3 — Resultados acumulados por equipo de la temporada activa (D2).
 *
 * UNA query (sin N+1): lee `match_state` (status + marcador) uniendo con
 * `events!inner` para filtrar por `events.team_id IN (teamIds)` y por los tipos
 * de partido. `match_state` es 1:1 con el evento; los eventos sin sesión de
 * captura no tienen fila → no cuentan como resultado. La decisión D2 (solo
 * `status='closed'`, marcador null no suma) la aplica `aggregateTeamResults` en
 * core; `teamIds` dirige la salida (una entrada por equipo, a ceros si no jugó).
 *
 * RLS heredada: `match_state_select` (`user_can_record_match`) deja a admin/coord
 * leer todo su club — sin políticas nuevas.
 */
export async function loadClubResults(teamIds: readonly string[]): Promise<TeamResults[]> {
  if (teamIds.length === 0) return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('match_state')
    .select('status, goals_for, goals_against, events!inner(team_id, type)')
    .in('events.team_id', teamIds)
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

/** Asistencia agregada del club + identidad de jugadores para el ranking. */
export interface ClubAttendanceData {
  agg: ClubAttendanceAgg;
  /** playerId → nombre formateado (para el ranking). */
  playerNames: Record<string, string>;
  /** playerId → teamId con más asistencia registrada (para etiquetar el ranking). */
  playerTeamId: Record<string, string>;
}

/**
 * F10.4 — Asistencia a entrenamientos de la temporada activa.
 *
 * UNA query principal (sin N+1): `training_attendance` uniendo `events!inner`
 * (type='training', team_id IN(teamIds)). Como los equipos son season-scoped,
 * filtrar por team_id ya acota a la temporada activa. Se delega en
 * `clubAttendanceAgg` (core): media de club, media por equipo, ranking por %
 * presencia y tendencia (por evento y por semana ISO).
 *
 * Una segunda query (IN, constante) trae los nombres de los jugadores del
 * ranking — la agregación es por id; los nombres son identidad, no matemática.
 * `playerTeamId` se deriva de las propias filas (equipo con más registros).
 *
 * RLS heredada: `training_attendance_select_member` deja a admin/coord leer todo
 * su club — sin políticas nuevas.
 */
export async function loadClubAttendance(teamIds: readonly string[]): Promise<ClubAttendanceData> {
  const empty: ClubAttendanceData = {
    agg: clubAttendanceAgg([]),
    playerNames: {},
    playerTeamId: {},
  };
  if (teamIds.length === 0) return empty;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('training_attendance')
    .select('player_id, code, event_id, events!inner(team_id, type, starts_at)')
    .eq('events.type', 'training')
    .in('events.team_id', teamIds);

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

/** Rankings por categoría + nombres de los jugadores que aparecen. */
export interface ClubRankingsData {
  byCategory: CategoryRankings[];
  /** playerId → nombre formateado (solo los que salen en algún ranking). */
  playerNames: Record<string, string>;
}

/**
 * F10.6 — Rankings POR CATEGORÍA (D5): goleadores, MVPs y mejor media.
 *
 * Sin N+1: tres lecturas con `IN (teamIds)` (teams→categoría, match_player_stats,
 * evaluations) + una cuarta para los nombres de los jugadores que SALEN en los
 * rankings (identidad, no matemática). La categoría se resuelve desde el equipo
 * (`teams.category_id` → `categories.name`) con un map en memoria; los goles y
 * valoraciones se atribuyen a la categoría del equipo con el que se registraron.
 * La agregación (top-N con empates, suelo de muestras) la hace `clubRankings`.
 *
 * D6: NO se gatea por `club_settings.evaluations_player_visibility`. El dashboard
 * es admin/coord, que ya leen `evaluations` por la RLS (`user_can_record_match`);
 * los rankings de rating se muestran siempre (ruptura deliberada de la regla de
 * F9, documentada en la spec 10.0 §6).
 *
 * RLS heredada: `match_player_stats_select` y `evaluations_select` (ambas vía
 * `user_can_record_match`) — sin políticas nuevas.
 */
export async function loadClubRankings(teamIds: readonly string[]): Promise<ClubRankingsData> {
  if (teamIds.length === 0) return { byCategory: [], playerNames: {} };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // teamId → categoría (id + nombre).
  const { data: rawTeams } = await supabase
    .from('teams')
    .select('id, category_id, categories!inner(name)')
    .in('id', teamIds);
  const teamCategory = new Map<string, { id: string; name: string }>();
  for (const t of (rawTeams ?? []) as unknown as TeamCategoryRow[]) {
    teamCategory.set(t.id, { id: t.category_id, name: t.categories.name });
  }

  const [{ data: rawStats }, { data: rawEvals }] = await Promise.all([
    supabase.from('match_player_stats').select('player_id, goals, team_id').in('team_id', teamIds),
    supabase
      .from('evaluations')
      .select('player_id, rating, is_mvp, team_id')
      .in('team_id', teamIds),
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

  // Nombres solo de los jugadores que aparecen en algún ranking.
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
