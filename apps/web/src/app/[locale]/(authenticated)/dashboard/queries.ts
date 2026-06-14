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
  activeSeasonLabel,
  currentSeason,
  createSupabaseServerClient,
  type ClubTeam,
  type ClubMember,
  type ClubCensus,
  type MatchResultRow,
  type TeamResults,
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
