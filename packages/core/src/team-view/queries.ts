import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { teamsInActiveSeason } from '../schemas/club-structure';
import { getActiveSeasonLabelFromClient } from '../season/active-season';
import type { TeamStaffRole } from '../schemas/staff';
import { COACH_ROLES } from '../auth/roles';
import {
  aggregateTeamStats,
  type RosterPlayer,
  type PlayerMatchStatRow,
} from '../player-profile/team-aggregate';
import type { AggregatedStats } from '../player-profile/aggregate';
import {
  listTeammates,
  listUpcomingTeamEvents,
  listVisibleAnnouncements,
  type TeammateCard,
  type TeamEventCard,
  type AnnouncementCard,
} from './helpers';

/**
 * O2-5 D1 — FETCH de "Mi equipo" (lectura), extraído de apps/web/.../mi-equipo/*.
 * El CÁLCULO ya vive en core (listTeammates/listUpcomingTeamEvents/
 * listVisibleAnnouncements/teamsInActiveSeason/aggregateTeamStats); aquí solo se
 * extrae el FETCH. Comportamiento idéntico al web.
 *
 * EJE HIJO ACTIVO (divergencia deliberada de la web): `getPlayerTeamsFromClient`
 * toma una LISTA de playerIds. La web pasa TODOS los hijos (agrega); la app pasa
 * SOLO el hijo activo (`[activePlayerId]`). La query es la misma; quién entra la
 * decide el caller. Todo LECTURA; la RLS es el gate.
 */
type DbClient = SupabaseClient<Database>;

// ── 1) Equipos del/los jugador(es) en el club (temporada activa) ───────────────

/** Una membresía activa de un jugador a un equipo de la temporada activa (con la
 * cabecera del equipo). Cada fila lleva `player_id` para saber qué hijo la aporta. */
export type PlayerTeamMembership = {
  player_id: string;
  team_id: string;
  name: string;
  color: string;
  format: string;
  category_id: string;
  season: string;
  category_name: string;
  half_duration_minutes: number;
};

export async function getPlayerTeamsFromClient(
  supabase: DbClient,
  clubId: string,
  playerIds: readonly string[],
  activeSeason: string,
): Promise<PlayerTeamMembership[]> {
  if (playerIds.length === 0) return [];
  const { data } = await supabase
    .from('team_members')
    .select(
      'player_id, team_id, teams!inner(id, name, color, format, category_id, season, categories!inner(name, club_id, half_duration_minutes))',
    )
    .in('player_id', playerIds as string[])
    .is('left_at', null);
  type TM = {
    player_id: string;
    team_id: string;
    teams: {
      id: string;
      name: string;
      color: string;
      format: string;
      category_id: string;
      season: string;
      categories: { name: string; club_id: string; half_duration_minutes: number };
    };
  };
  const rows = ((data ?? []) as unknown as TM[])
    .filter((r) => r.teams.categories.club_id === clubId)
    .map((r) => ({
      player_id: r.player_id,
      team_id: r.team_id,
      name: r.teams.name,
      color: r.teams.color,
      format: r.teams.format,
      category_id: r.teams.category_id,
      season: r.teams.season,
      category_name: r.teams.categories.name,
      half_duration_minutes: r.teams.categories.half_duration_minutes,
    }));
  // Bug-1: solo equipos de la temporada activa (evita duplicados tras el rollover).
  return teamsInActiveSeason(rows, activeSeason);
}

// ── 2) Home del equipo (compañeros + próximos eventos + anuncios) ──────────────

export type TeamHome = {
  teammates: TeammateCard[];
  upcoming: TeamEventCard[];
  announcements: AnnouncementCard[];
};

export async function getTeamHomeFromClient(
  supabase: DbClient,
  clubId: string,
  teamId: string,
  activePlayerId: string,
  allTeamIds: readonly string[],
  nowIso: string,
): Promise<TeamHome> {
  // Compañeros (otros players del equipo activo).
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('player_id, players!inner(id, first_name, last_name, dorsal, photo_url)')
    .eq('team_id', teamId)
    .is('left_at', null);
  type RosterRow = {
    player_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
      dorsal: number | null;
      photo_url: string | null;
    };
  };
  const roster = ((rosterRows ?? []) as unknown as RosterRow[]).map((r) => r.players);
  const teammates = listTeammates(roster, activePlayerId);

  // Próximos eventos del equipo (30 días; el helper puro re-filtra + ordena + limita).
  const nowMs = Date.parse(nowIso);
  const horizonIso = new Date(nowMs + 30 * 86_400_000).toISOString();
  const { data: eventRows } = await supabase
    .from('events')
    .select('id, title, type, starts_at, ends_at, location_name, opponent_name')
    .eq('team_id', teamId)
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .gte('starts_at', nowIso)
    .lte('starts_at', horizonIso)
    .order('starts_at', { ascending: true });
  type Ev = {
    id: string;
    title: string;
    type: string;
    starts_at: string;
    ends_at: string | null;
    location_name: string | null;
    opponent_name: string | null;
  };
  const upcoming = listUpcomingTeamEvents((eventRows ?? []) as Ev[], nowIso, 30, 10);

  // Anuncios visibles (RLS filtra; el helper hace pinned-first + orden + limit 5).
  const { data: annRows } = await supabase
    .from('announcements')
    .select('id, title, body, pinned, team_id, created_at')
    .eq('club_id', clubId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);
  type AnnRow = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    team_id: string | null;
    created_at: string;
  };
  const announcements = listVisibleAnnouncements(
    (annRows ?? []) as AnnRow[],
    allTeamIds as string[],
    5,
  );

  return { teammates, upcoming, announcements };
}

// ── 3) Plantilla: roster del equipo con stats por jugador ──────────────────────

export type RosterStatRow = {
  player_id: string;
  first_name: string;
  last_name: string | null;
  /** Dorsal efectivo: override del equipo ?? dorsal deportivo. */
  dorsal: number | null;
  /** Posición efectiva: override del equipo ?? posición principal. */
  position: string | null;
  foot: string | null;
  stats: AggregatedStats;
};

export async function getTeamRosterStatsFromClient(
  supabase: DbClient,
  teamId: string,
): Promise<RosterStatRow[]> {
  // 1) Roster del equipo (override del día por equipo). RLS team_members = clubmate.
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('player_id, dorsal_in_team, position_in_team')
    .eq('team_id', teamId)
    .is('left_at', null);
  type TM = {
    player_id: string;
    dorsal_in_team: number | null;
    position_in_team: string | null;
  };
  const tm = (tmRows ?? []) as TM[];
  if (tm.length === 0) return [];
  const ids = tm.map((r) => r.player_id);

  // 2) Identidad SOLO-deportiva (F14C: el jugador tiene SELECT en players_sporting).
  const { data: spRows } = await supabase
    .from('players_sporting')
    .select('id, first_name, last_name, dorsal, position_main, foot')
    .in('id', ids);
  type SP = {
    id: string;
    first_name: string;
    last_name: string | null;
    dorsal: number | null;
    position_main: string | null;
    foot: string | null;
  };
  const spById = new Map(((spRows ?? []) as SP[]).map((s) => [s.id, s]));

  // 3) Stats de match del equipo (RLS F14E-6: compañero de equipo).
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(
      'player_id, started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed',
    )
    .eq('team_id', teamId);
  const rows = (statRows ?? []) as unknown as PlayerMatchStatRow[];

  // Roster para el agregado (nombres desde players_sporting). Cada jugador aparece
  // aunque tenga 0 partidos (invariante de aggregateTeamStats).
  const roster: RosterPlayer[] = tm.map((r) => {
    const sp = spById.get(r.player_id);
    return {
      player_id: r.player_id,
      first_name: sp?.first_name ?? '',
      last_name: sp?.last_name ?? null,
      dorsal_in_team: r.dorsal_in_team,
      position_in_team: r.position_in_team,
    };
  });

  const { perPlayer } = aggregateTeamStats(roster, rows);

  const merged: RosterStatRow[] = perPlayer.map((p) => {
    const sp = spById.get(p.player_id);
    return {
      player_id: p.player_id,
      first_name: p.first_name,
      last_name: p.last_name,
      dorsal: p.dorsal_in_team ?? sp?.dorsal ?? null,
      position: p.position_in_team ?? sp?.position_main ?? null,
      foot: sp?.foot ?? null,
      stats: p.stats,
    };
  });

  // Orden: dorsal asc (sin dorsal al final), luego por nombre.
  merged.sort((a, b) => {
    if (a.dorsal == null && b.dorsal == null) {
      return a.first_name.localeCompare(b.first_name, 'es', { sensitivity: 'base' });
    }
    if (a.dorsal == null) return 1;
    if (b.dorsal == null) return -1;
    return a.dorsal - b.dorsal;
  });

  return merged;
}

// ── 4) Cuerpo técnico ligero: nombre + rol del staff de unos equipos ───────────

export type LightStaffMember = {
  team_staff_id: string;
  full_name: string;
  staff_role: TeamStaffRole;
};

export type LightTeamStaff = {
  team_id: string;
  team_name: string;
  team_color: string;
  members: LightStaffMember[];
};

/** Staff (nombre + rol, SIN contacto) de unos equipos YA resueltos. La resolución
 * de "qué equipos" la hace el caller (web: unión jugador+entrenador; app: equipos
 * del hijo activo). RLS `team_staff_select_member`: cualquier miembro del club lee. */
export async function getTeamStaffLightFromClient(
  supabase: DbClient,
  teams: ReadonlyArray<{ id: string; name: string; color: string }>,
): Promise<LightTeamStaff[]> {
  if (teams.length === 0) return [];
  const teamIds = teams.map((t) => t.id);

  type StaffJoin = {
    id: string;
    team_id: string;
    staff_role: TeamStaffRole;
    memberships: { profiles: { full_name: string | null } };
  };
  const { data: staffRaw } = await supabase
    .from('team_staff')
    .select('id, team_id, staff_role, memberships!inner(profiles!inner(full_name))')
    .in('team_id', teamIds)
    .is('left_at', null);
  const staff = (staffRaw ?? []).map((r) => r as unknown as StaffJoin);

  const byTeam = new Map<string, LightStaffMember[]>();
  for (const s of staff) {
    const list = byTeam.get(s.team_id) ?? [];
    list.push({
      team_staff_id: s.id,
      full_name: s.memberships.profiles.full_name ?? '—',
      staff_role: s.staff_role,
    });
    byTeam.set(s.team_id, list);
  }

  return teams
    .map((t) => ({
      team_id: t.id,
      team_name: t.name,
      team_color: t.color,
      members: (byTeam.get(t.id) ?? []).sort((a, b) =>
        a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' }),
      ),
    }))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, 'es'));
}

// ─────────────────────────────────────────────────────────────────────────────
// O2-10a — "Mis equipos" del cuerpo técnico. Extraído de apps/web/.../mis-equipos
// (`loadStaffTeams`). Equipos donde el usuario es `team_staff` activo, DEDUP por
// equipo (un usuario puede tener varias filas staff_role en el mismo equipo →
// se queda el rol de mayor prioridad para el badge). Coordinador incluido (E-final:
// "mis equipos" del coordinador = los que coordina). Lectura; la RLS es el gate.
// La web pasa a DELEGAR aquí (mapea al shape nested que usa su dashboard).
// ─────────────────────────────────────────────────────────────────────────────

/** Tarjeta de equipo del staff (lista de "Mis equipos"). */
export type StaffTeamCard = {
  teamId: string;
  staffRole: string;
  name: string;
  color: string;
  format: string;
  season: string;
  categoryId: string;
  categoryName: string;
};

/** Roles que cuentan como "mis equipos" del staff (coach + coordinador). */
const STAFF_TEAM_ROLES = new Set<string>([...COACH_ROLES, 'coordinador']);

/** Prioridad para elegir el badge/dedup cuando hay varios staff_role en un equipo. */
const STAFF_TEAM_ROLE_PRIORITY: Record<string, number> = {
  entrenador_principal: 3,
  entrenador_ayudante: 2,
  coordinador: 1,
};

export async function getStaffTeamsFromClient(
  supabase: SupabaseClient<Database>,
  params: { membershipId: string; clubId: string },
): Promise<StaffTeamCard[]> {
  const { data } = await supabase
    .from('team_staff')
    .select(
      'team_id, staff_role, teams!inner(id, name, color, format, season, categories!inner(id, club_id, name))',
    )
    .eq('membership_id', params.membershipId)
    .is('left_at', null);

  type Row = {
    team_id: string;
    staff_role: string;
    teams: {
      id: string;
      name: string;
      color: string;
      format: string;
      season: string;
      categories: { id: string; club_id: string; name: string };
    };
  };
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (s) =>
      STAFF_TEAM_ROLES.has(s.staff_role) &&
      s.teams.categories.club_id === params.clubId,
  );

  // Dedup por equipo: nos quedamos con el staff_role de mayor prioridad.
  const byTeam = new Map<string, Row>();
  for (const s of rows) {
    const cur = byTeam.get(s.team_id);
    if (
      !cur ||
      (STAFF_TEAM_ROLE_PRIORITY[s.staff_role] ?? 0) >
        (STAFF_TEAM_ROLE_PRIORITY[cur.staff_role] ?? 0)
    ) {
      byTeam.set(s.team_id, s);
    }
  }

  return [...byTeam.values()]
    .map((s) => ({
      teamId: s.team_id,
      staffRole: s.staff_role,
      name: s.teams.name,
      color: s.teams.color,
      format: s.teams.format,
      season: s.teams.season,
      categoryId: s.teams.categories.id,
      categoryName: s.teams.categories.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

// ─────────────────────────────────────────────────────────────────────────────
// O2-11a-1 — Equipos del CLUB (temporada activa), CLUB-WIDE. A diferencia de
// `getStaffTeamsFromClient` (los equipos `team_staff` del usuario), enumera TODOS
// los equipos del club → lo usa dirección (admin_club/director, RLS club-wide) como
// picker de anuncios, donde un admin puede no tener filas team_staff. Solo lectura;
// la RLS `teams_select_member` es el gate (cualquier miembro lee; la banda la acota
// AreaGuard('direction')). Temporada activa para no duplicar el mismo equipo por
// temporada (unique club_id,name,season).
// ─────────────────────────────────────────────────────────────────────────────

/** Tarjeta de equipo club-wide (picker de dirección). */
export type ClubTeamCard = {
  teamId: string;
  name: string;
  color: string;
  categoryName: string;
};

export async function getClubTeamsFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<ClubTeamCard[]> {
  const activeSeason = await getActiveSeasonLabelFromClient(supabase, clubId);
  const { data } = await supabase
    .from('teams')
    .select('id, name, color, season, categories!inner(club_id, name)')
    .eq('club_id', clubId)
    .eq('season', activeSeason)
    .order('name');

  type Row = {
    id: string;
    name: string;
    color: string;
    season: string;
    categories: { club_id: string; name: string };
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.categories.club_id === clubId)
    .map((r) => ({
      teamId: r.id,
      name: r.name,
      color: r.color,
      categoryName: r.categories.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}
