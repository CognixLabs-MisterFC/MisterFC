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
 * iterar por equipo). El resto de secciones (resultados, asistencia, alertas,
 * rankings) añadirán su carga en 10.3–10.6 reusando `teamIds`.
 */

import {
  aggregateClubStats,
  activeSeasonLabel,
  currentSeason,
  createSupabaseServerClient,
  type ClubTeam,
  type ClubMember,
  type ClubCensus,
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
