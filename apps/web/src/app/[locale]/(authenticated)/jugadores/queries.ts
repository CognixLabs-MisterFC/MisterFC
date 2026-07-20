/**
 * F2.10 — Queries del listado global de jugadores.
 *
 * Reusa exclusivamente las tablas existentes (`players`, `team_members`,
 * `teams`, `categories`, `memberships`, `team_staff`, `capabilities`).
 * Cero modelo nuevo.
 *
 * Permisos de lectura (visibilidad):
 *  - admin_club / coordinador → todos los jugadores del club.
 *  - entrenador_principal → solo jugadores cuya pertenencia ACTIVA es a un team
 *    donde el user es staff activo (team_staff.left_at IS NULL).
 *  - entrenador_ayudante con can_manage_squad → idem que principal.
 *  - entrenador_ayudante sin can_manage_squad → 0 resultados (la page mostrará
 *    un estado "no tienes permiso para ver este listado").
 *  - jugador → no debería llegar aquí (la page redirige antes).
 *
 * Permisos de escritura (acción "asignar a equipo"): mismos roles que arriba
 * para los jugadores visibles. Verificado en BD por las policies de F1.7.
 */

import {
  PLAYER_POSITIONS,
  type PlayerPosition,
  createSupabaseServerClient,
  getCurrentUser,
  teamsInActiveSeason,
  summarizePendingInvites,
  type PendingInviteCandidate,
  type PendingInviteSummary,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

// Role canónico de core (fuente única; incluye 'director' — F1B). Se importa y
// re-exporta porque este módulo lo usa internamente y muchas rutas lo importan de aquí.
import type { Role } from '@misterfc/core';
export type { Role };

export type VisibilityScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[] }
  | { kind: 'none' };

export type PlayerRow = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  dorsal: number | null;
  position_main: PlayerPosition | null;
  current_team_id: string | null;
  current_team_name: string | null;
  current_team_color: string | null;
  current_category_id: string | null;
  current_category_name: string | null;
  current_category_season: string | null;
  has_account: boolean;
  /** Rework C (C11a): jugador dado de baja del club (left_club_at no nulo). */
  is_left_club: boolean;
};

export type TeamOption = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  category_name: string;
  season: string;
};

export type GlobalPlayersFilters = {
  search: string;
  years: number[];
  positions: string[];
  teamIds: string[];
  /** C11a: incluir bajas en el listado (por defecto se ocultan). */
  showLeftClub: boolean;
  /** C11a: solo jugadores club-activos SIN equipo (derivado). */
  noTeam: boolean;
};

export type GlobalPlayersResult = {
  players: PlayerRow[];
  total: number;
  /** Equipos visibles para el filtro y para el dialog "Asignar a equipo". */
  visibleTeams: TeamOption[];
  /** Años de nacimiento presentes en el conjunto visible (orden descendente). */
  visibleYears: number[];
  /** El user puede ejecutar la acción "Asignar a equipo" sobre los visibles. */
  canManage: boolean;
  /** C11a: nº de jugadores club-activos sin equipo (para el segmento/badge). */
  noTeamCount: number;
};

export const PLAYERS_PAGE_SIZE = 50;

/**
 * Determina el scope de visibilidad del user en el club activo.
 * No-throw: si no hay sesión, devuelve { kind: 'none' }.
 */
export async function resolveVisibilityScope(
  clubId: string,
  role: Role
): Promise<VisibilityScope> {
  // E-7a: director club-wide como admin_club. Se separa ARRIBA para que no caiga
  // en la query de staff de abajo (que le daría restricted con teamIds=[] → vacío).
  if (role === 'admin_club' || role === 'director') {
    return { kind: 'all' };
  }
  // C-2a: el coordinador cae en 'restricted' (sus equipos vía team_staff, cualquier
  // staff_role), como el principal. admin_club/director/ayudante NO cambian.
  if (role === 'jugador') return { kind: 'none' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  if (!user) return { kind: 'none' };

  // ayudante: exige can_manage_squad en el club activo.
  if (role === 'entrenador_ayudante') {
    type CapRow = {
      granted: boolean;
      memberships: { profile_id: string; club_id: string };
    };
    const { data: caps } = await supabase
      .from('capabilities')
      .select('granted, memberships!inner(profile_id, club_id)')
      .eq('capability_name', 'can_manage_squad')
      .eq('granted', true);
    const hasSquadCap = (caps ?? []).some((row) => {
      const r = row as unknown as CapRow;
      return (
        r.memberships.profile_id === user.id &&
        r.memberships.club_id === clubId &&
        r.granted
      );
    });
    if (!hasSquadCap) return { kind: 'none' };
  }

  // Equipos donde el user es staff activo en el club activo.
  type StaffRow = {
    team_id: string;
    memberships: { profile_id: string; club_id: string };
  };
  const { data: staff } = await supabase
    .from('team_staff')
    .select('team_id, memberships!inner(profile_id, club_id)')
    .is('left_at', null);

  const teamIds = (staff ?? [])
    .map((row) => row as unknown as StaffRow)
    .filter(
      (r) =>
        r.memberships.profile_id === user.id &&
        r.memberships.club_id === clubId
    )
    .map((r) => r.team_id);

  return { kind: 'restricted', teamIds };
}

/**
 * Carga los equipos visibles del club (filtrados por scope).
 */
async function loadVisibleTeams(
  clubId: string,
  scope: VisibilityScope
): Promise<TeamOption[]> {
  if (scope.kind === 'none') return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('teams')
    .select('id, name, color, season, category_id, categories!inner(name, club_id)')
    .order('name');

  type Row = {
    id: string;
    name: string;
    color: string;
    season: string;
    category_id: string;
    categories: { name: string; club_id: string };
  };

  const all: TeamOption[] = (data ?? [])
    .map((r) => r as unknown as Row)
    .filter((r) => r.categories.club_id === clubId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      category_id: r.category_id,
      category_name: r.categories.name,
      season: r.season,
    }));

  // Bug-1: selector operativo → solo la temporada activa (sin duplicados del
  // rollover). La asignación de jugadores opera sobre la temporada en curso.
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const scoped = teamsInActiveSeason(all, activeSeason);

  if (scope.kind === 'restricted') {
    const allowed = new Set(scope.teamIds);
    return scoped.filter((t) => allowed.has(t.id));
  }
  return scoped;
}

/**
 * Carga el conjunto paginado de jugadores con filtros aplicados.
 */
export async function loadGlobalPlayers(
  clubId: string,
  role: Role,
  filters: GlobalPlayersFilters,
  page: number
): Promise<GlobalPlayersResult> {
  const scope = await resolveVisibilityScope(clubId, role);

  if (scope.kind === 'none') {
    return {
      players: [],
      total: 0,
      visibleTeams: [],
      visibleYears: [],
      canManage: false,
      noTeamCount: 0,
    };
  }

  const visibleTeams = await loadVisibleTeams(clubId, scope);
  const visibleTeamIds = visibleTeams.map((t) => t.id);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Compone la query principal sobre `players`. El embed de `team_members`
  // se filtra por `left_at IS NULL` para traer la pertenencia activa.
  const positionsValid = filters.positions.filter((p) =>
    (PLAYER_POSITIONS as readonly string[]).includes(p)
  );

  // El filtro de equipo en URL puede traer ids fuera del scope; los recortamos
  // a la intersección con visibleTeamIds.
  const teamFilter =
    scope.kind === 'restricted'
      ? filters.teamIds.filter((id) => visibleTeamIds.includes(id))
      : filters.teamIds;

  // El scope para construir la query final:
  //  - admin/coord sin team filter → todos los jugadores del club.
  //  - admin/coord con team filter → jugadores con pertenencia activa a esos teams.
  //  - principal/ayudante sin team filter → jugadores con pertenencia activa a
  //    cualquier visible team.
  //  - principal/ayudante con team filter → intersección.

  const effectiveTeamFilter =
    scope.kind === 'restricted' && teamFilter.length === 0
      ? visibleTeamIds
      : teamFilter;

  // C11a: nº de jugadores club-activos sin equipo (solo admin/coord lo gestionan;
  // para scope restringido no aplica → 0). Excluye bajas siempre.
  const noTeamIds =
    scope.kind === 'all' ? await loadNoTeamPlayerIds(clubId) : [];
  const noTeamCount = noTeamIds.length;

  // Si principal/ayudante no tiene equipos asignados → 0 resultados.
  if (scope.kind === 'restricted' && visibleTeamIds.length === 0) {
    return {
      players: [],
      total: 0,
      visibleTeams,
      visibleYears: [],
      canManage: true,
      noTeamCount,
    };
  }

  // Construye la lista de player_ids permitidos si hay restricción por equipo.
  let allowedPlayerIds: string[] | null = null;
  if (effectiveTeamFilter.length > 0) {
    const { data: tmRows } = await supabase
      .from('team_members')
      .select('player_id, team_id')
      .is('left_at', null)
      .in('team_id', effectiveTeamFilter);
    allowedPlayerIds = Array.from(
      new Set((tmRows ?? []).map((r) => r.player_id as string))
    );
    if (allowedPlayerIds.length === 0) {
      return {
        players: [],
        total: 0,
        visibleTeams,
        visibleYears: [],
        canManage: true,
        noTeamCount,
      };
    }
  }

  // C11a: el filtro "sin equipo" restringe a los club-activos sin membresía
  // abierta (intersecta con cualquier restricción de equipo → normalmente vacío).
  if (filters.noTeam) {
    allowedPlayerIds = allowedPlayerIds
      ? allowedPlayerIds.filter((id) => noTeamIds.includes(id))
      : noTeamIds;
    if (allowedPlayerIds.length === 0) {
      return {
        players: [],
        total: 0,
        visibleTeams,
        visibleYears: [],
        canManage: true,
        noTeamCount,
      };
    }
  }

  // Query principal de players con conteo.
  let q = supabase
    .from('players')
    .select(
      `id, first_name, last_name, date_of_birth, dorsal, position_main, left_club_at,
       team_members!left(team_id, left_at, teams(id, name, color, season, categories(id, name))),
       player_accounts(profile_id)`,
      { count: 'exact' }
    )
    .eq('club_id', clubId)
    // F14-7: los jugadores SUPRIMIDOS (derecho al olvido) se excluyen SIEMPRE del
    // listado, incluso con el toggle "ver bajas". Supresión ≠ baja.
    .is('erased_at', null);

  // C11a: por defecto se ocultan las bajas (left_club_at IS NULL). El toggle
  // "ver bajas" las incluye para consultar su histórico.
  if (!filters.showLeftClub) {
    q = q.is('left_club_at', null);
  }

  if (allowedPlayerIds) {
    q = q.in('id', allowedPlayerIds);
  }

  if (filters.search.trim().length > 0) {
    const term = filters.search.trim();
    const escaped = term.replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.or(
      `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`
    );
  }

  if (positionsValid.length > 0) {
    q = q.in('position_main', positionsValid);
  }

  if (filters.years.length > 0) {
    const ranges = filters.years
      .map((y) => `and(date_of_birth.gte.${y}-01-01,date_of_birth.lte.${y}-12-31)`)
      .join(',');
    q = q.or(ranges);
  }

  const from = (page - 1) * PLAYERS_PAGE_SIZE;
  const to = from + PLAYERS_PAGE_SIZE - 1;

  q = q
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range(from, to);

  const { data, count } = await q;

  type TMRow = {
    team_id: string;
    left_at: string | null;
    teams: {
      id: string;
      name: string;
      color: string;
      season: string;
      categories: { id: string; name: string };
    } | null;
  };

  const players: PlayerRow[] = (data ?? []).map((p) => {
    const tms = (p.team_members as unknown as TMRow[] | null) ?? [];
    const active = tms.find((tm) => tm.left_at == null && tm.teams);
    const accounts = (p.player_accounts as unknown as Array<{ profile_id: string }> | null) ?? [];
    return {
      id: p.id as string,
      first_name: p.first_name as string,
      last_name: p.last_name as string,
      date_of_birth: p.date_of_birth as string,
      dorsal: (p.dorsal as number | null) ?? null,
      position_main: (p.position_main as PlayerPosition | null) ?? null,
      current_team_id: active?.teams?.id ?? null,
      current_team_name: active?.teams?.name ?? null,
      current_team_color: active?.teams?.color ?? null,
      current_category_id: active?.teams?.categories?.id ?? null,
      current_category_name: active?.teams?.categories?.name ?? null,
      current_category_season: active?.teams?.season ?? null,
      has_account: accounts.length > 0,
      is_left_club: (p.left_club_at as string | null) != null,
    };
  });

  // Para el filtro de años: distintos años presentes en los jugadores VISIBLES
  // (no solo los que pasaron los filtros — para que el usuario pueda navegar).
  const visibleYears = await loadVisibleYears(clubId, allowedPlayerIds);

  return {
    players,
    total: count ?? 0,
    visibleTeams,
    visibleYears,
    canManage: true,
    noTeamCount,
  };
}

/**
 * C11a — player_ids de jugadores CLUB-ACTIVOS (left_club_at IS NULL) SIN equipo:
 * sin ningún team_members abierto en equipos del club. Las bajas se excluyen
 * siempre (no cuentan como "sin equipo"). Derivado, sin columna nueva.
 */
async function loadNoTeamPlayerIds(clubId: string): Promise<string[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: activeData } = await supabase
    .from('players')
    .select('id')
    .eq('club_id', clubId)
    .is('left_club_at', null)
    .is('erased_at', null); // F14-7: los suprimidos no son "sin equipo"
  const activeIds = (activeData ?? []).map((r) => r.id as string);
  if (activeIds.length === 0) return [];

  // "Sin equipo" se juzga SOLO en la temporada activa: un jugador con equipo únicamente
  // en una temporada anterior (finalizada) debe contar como sin equipo en la activa.
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const { data: teamData } = await supabase
    .from('teams')
    .select('id')
    .eq('club_id', clubId)
    .eq('season', activeSeason);
  const clubTeamIds = (teamData ?? []).map((r) => r.id as string);

  const withTeam = new Set<string>();
  if (clubTeamIds.length > 0) {
    const { data: tmData } = await supabase
      .from('team_members')
      .select('player_id')
      .is('left_at', null)
      .in('team_id', clubTeamIds);
    for (const r of tmData ?? []) withTeam.add(r.player_id as string);
  }

  return activeIds.filter((id) => !withTeam.has(id));
}

async function loadVisibleYears(
  clubId: string,
  allowedPlayerIds: string[] | null
): Promise<number[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  let q = supabase
    .from('players')
    .select('date_of_birth')
    .eq('club_id', clubId);

  if (allowedPlayerIds) q = q.in('id', allowedPlayerIds);

  const { data } = await q;
  const yearSet = new Set<number>();
  for (const row of data ?? []) {
    const dob = (row.date_of_birth as string | null) ?? null;
    if (dob && dob.length >= 4) {
      const y = parseInt(dob.slice(0, 4), 10);
      if (!Number.isNaN(y)) yearSet.add(y);
    }
  }
  return [...yearSet].sort((a, b) => b - a);
}

// ─────────────────────────────────────────────────────────────────────────────
// F14K-1 — Jugadores PENDIENTES DE INVITAR (base del motor de lote de K-2).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opciones de la query de pendientes.
 *  - `playerIds`: acota a esos jugadores concretos (botón 1, recién importados —
 *    los que devuelve el import en result.details). Sin él → todos los del club
 *    (botón 2, listado). Una lista vacía significa "ninguno" (no "todos").
 */
export type PendingInviteOptions = {
  playerIds?: string[];
};

const EMPTY_PENDING: PendingInviteSummary = {
  players: [],
  count_players: 0,
  count_emails: 0,
  emails: [],
};

/**
 * Devuelve los jugadores "pendientes de invitar" del club activo, agrupados por
 * email (para el conteo del tope de 100/h de K-2). Un jugador está pendiente si:
 *   · `invite_email` presente y no vacío,
 *   · NO tiene player_account (nadie ha aceptado acceso para él),
 *   · NO tiene una invitación pendiente vigente (invitations con su player_id,
 *     accepted_at IS NULL, expires_at > now) → si la tiene, se salta (no reinvitar),
 *   · `erased_at` IS NULL (borrado RGPD fuera).
 * `left_club_at` NO excluye: una baja reactivada vuelve a estar pendiente. Sin
 * lógica de temporadas — los que continúan ya tienen player_account y quedan fuera
 * solos por el filtro "sin cuenta".
 *
 * Permiso de lectura: SOLO admin/director del club (coordinador NO). La RLS de
 * `invitations` ya lo respalda tras el fix F14K-1 (director ve las del club).
 */
export async function loadPendingInvitePlayers(
  clubId: string,
  role: Role,
  options: PendingInviteOptions = {},
): Promise<PendingInviteSummary> {
  // Solo admin/director ven la lista de pendientes.
  if (role !== 'admin_club' && role !== 'director') {
    return EMPTY_PENDING;
  }

  // Acotado explícito a "ningún jugador" → nada que invitar.
  if (options.playerIds && options.playerIds.length === 0) {
    return EMPTY_PENDING;
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Candidatos: con invite_email, no borrados, y traemos player_accounts para
  //    descartar a los que ya tienen acceso. (left_club_at NO se filtra.)
  let q = supabase
    .from('players')
    .select('id, first_name, last_name, invite_email, player_accounts(profile_id)')
    .eq('club_id', clubId)
    .is('erased_at', null)
    .not('invite_email', 'is', null);

  if (options.playerIds) {
    q = q.in('id', options.playerIds);
  }

  const { data } = await q;

  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    invite_email: string | null;
    player_accounts: Array<{ profile_id: string }> | null;
  };

  // Sin cuenta + email no vacío.
  const candidates = ((data ?? []) as unknown as Row[]).filter((r) => {
    const accounts = r.player_accounts ?? [];
    const email = (r.invite_email ?? '').trim();
    return accounts.length === 0 && email.length > 0;
  });
  if (candidates.length === 0) return EMPTY_PENDING;

  // 2) Descartar los que YA tienen invitación pendiente vigente (no reinvitar).
  const candidateIds = candidates.map((r) => r.id);
  const nowIso = new Date().toISOString();
  const { data: pend } = await supabase
    .from('invitations')
    .select('player_id')
    .eq('club_id', clubId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .in('player_id', candidateIds);
  const alreadyPending = new Set(
    (pend ?? [])
      .map((r) => r.player_id as string | null)
      .filter((id): id is string => id != null),
  );

  const pendingPlayers: PendingInviteCandidate[] = candidates
    .filter((r) => !alreadyPending.has(r.id))
    .map((r) => ({
      player_id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      invite_email: (r.invite_email ?? '').trim(),
    }));

  // 3) Agrupado por email (case-insensitive) → conteo de emails distintos.
  return summarizePendingInvites(pendingPlayers);
}
