/**
 * F2.11 — Queries del listado global del cuerpo técnico.
 *
 * Reusa exclusivamente las tablas existentes (`memberships`, `team_staff`,
 * `teams`, `categories`, `capabilities`, `events`, `profiles`). Cero modelo
 * nuevo.
 *
 * Permisos de lectura (visibilidad):
 *  - admin_club / coordinador → todos los staff activos del club.
 *  - entrenador_principal → solo staff cuyos teams comparten con los suyos.
 *    Los ayudantes ven aquí "los compañeros de banquillo".
 *  - entrenador_ayudante / jugador → la page redirige antes de llegar aquí.
 *
 * Permisos de escritura (mover staff entre equipos): admin_club / coordinador
 * solo. Verificado por la policy `team_staff_update_admin` / `_insert_admin`
 * de F2.6.
 */

import {
  ADMIN_ROLES,
  COACH_ROLES,
  TEAM_STAFF_ROLES,
  type TeamStaffRole,
  createSupabaseServerClient,
  getCurrentUser,
  teamsInActiveSeason,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import type { Role } from '../jugadores/queries';

export type StaffScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[] }
  | { kind: 'none' };

export type CoachTeamAssignment = {
  team_staff_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  category_id: string;
  category_name: string;
  category_season: string;
  staff_role: TeamStaffRole;
  joined_at: string;
};

export type CoachRow = {
  membership_id: string;
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  club_role: 'entrenador_principal' | 'entrenador_ayudante';
  assignments: CoachTeamAssignment[];
  /** Resumen de caps concedidas, solo para ayudantes (X / 9). */
  caps_granted: number | null;
  /** Contacto gestionado por el club (Bug 2 · 2c). NO es el email de login. */
  phone: string | null;
  contact_email: string | null;
};

export type TeamOption = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  category_name: string;
  season: string;
};

export type CategoryOption = {
  id: string;
  name: string;
};

export type CoachFilters = {
  search: string;
  staffRoles: TeamStaffRole[];
  teamIds: string[];
  categoryIds: string[];
};

export type CoachListResult = {
  coaches: CoachRow[];
  total: number;
  visibleTeams: TeamOption[];
  visibleCategories: CategoryOption[];
  /** El user puede mover staff entre equipos. */
  canManage: boolean;
};

const WRITE_ROLES = ADMIN_ROLES;

/**
 * Determina el scope de visibilidad del user para listar cuerpo técnico.
 */
export async function resolveStaffScope(
  clubId: string,
  role: Role
): Promise<StaffScope> {
  if (role === 'admin_club' || role === 'coordinador') return { kind: 'all' };
  if (role !== 'entrenador_principal') return { kind: 'none' };

  // Principal: ve a staff de SUS teams. Resolvemos sus teams activos.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  if (!user) return { kind: 'none' };

  type Row = {
    team_id: string;
    memberships: { profile_id: string; club_id: string };
  };
  const { data } = await supabase
    .from('team_staff')
    .select('team_id, memberships!inner(profile_id, club_id)')
    .is('left_at', null);

  const teamIds = (data ?? [])
    .map((r) => r as unknown as Row)
    .filter(
      (r) =>
        r.memberships.profile_id === user.id &&
        r.memberships.club_id === clubId
    )
    .map((r) => r.team_id);

  return { kind: 'restricted', teamIds };
}

async function loadVisibleTeams(
  clubId: string,
  scope: StaffScope
): Promise<TeamOption[]> {
  if (scope.kind === 'none') return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('teams')
    .select(
      'id, name, color, season, category_id, categories!inner(name, club_id)'
    )
    .order('name');

  type Row = {
    id: string;
    name: string;
    color: string;
    season: string;
    category_id: string;
    categories: { name: string; club_id: string };
  };

  const all = (data ?? [])
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

  // Bug-1: mover staff es operativo → solo equipos de la temporada activa
  // (evita los duplicados por nombre que dejó el rollover).
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const scoped = teamsInActiveSeason(all, activeSeason);

  if (scope.kind === 'restricted') {
    const allowed = new Set(scope.teamIds);
    return scoped.filter((t) => allowed.has(t.id));
  }
  return scoped;
}

async function loadVisibleCategories(
  clubId: string,
  visibleTeams: TeamOption[],
  scope: StaffScope
): Promise<CategoryOption[]> {
  if (scope.kind === 'restricted') {
    // Solo categorías de los teams visibles.
    const map = new Map<string, CategoryOption>();
    for (const t of visibleTeams) {
      if (!map.has(t.category_id)) {
        map.set(t.category_id, {
          id: t.category_id,
          name: t.category_name,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Rework A (A4) — la categoría es plantilla permanente sin temporada; el filtro
  // de categoría del cuerpo técnico ya no la muestra/ordena por season.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data } = await supabase
    .from('categories')
    .select('id, name')
    .eq('club_id', clubId)
    .order('name');
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));
}

/**
 * Carga la lista global del cuerpo técnico del club, agrupada por coach.
 * Sin paginación en Ola 1 (un club piloto típico tiene < 20 entrenadores).
 */
export async function loadCoachList(
  clubId: string,
  role: Role,
  filters: CoachFilters
): Promise<CoachListResult> {
  const scope = await resolveStaffScope(clubId, role);
  if (scope.kind === 'none') {
    return {
      coaches: [],
      total: 0,
      visibleTeams: [],
      visibleCategories: [],
      canManage: false,
    };
  }

  const visibleTeams = await loadVisibleTeams(clubId, scope);
  const visibleCategories = await loadVisibleCategories(
    clubId,
    visibleTeams,
    scope
  );
  const canManage = WRITE_ROLES.includes(role);

  if (scope.kind === 'restricted' && visibleTeams.length === 0) {
    return {
      coaches: [],
      total: 0,
      visibleTeams,
      visibleCategories,
      canManage,
    };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const visibleTeamIds = visibleTeams.map((t) => t.id);

  let staffQ = supabase
    .from('team_staff')
    .select(
      `id, staff_role, joined_at, team_id, membership_id,
       teams!inner(id, name, color, category_id, season, categories!inner(id, name, club_id)),
       memberships!inner(id, role, club_id, profile_id, phone, contact_email, profiles!inner(id, full_name, avatar_url))`
    )
    .is('left_at', null);

  if (scope.kind === 'restricted' && visibleTeamIds.length > 0) {
    staffQ = staffQ.in('team_id', visibleTeamIds);
  }

  const { data: rawStaff } = await staffQ;

  type StaffJoin = {
    id: string;
    staff_role: TeamStaffRole;
    joined_at: string;
    team_id: string;
    membership_id: string;
    teams: {
      id: string;
      name: string;
      color: string;
      category_id: string;
      season: string;
      categories: {
        id: string;
        name: string;
        club_id: string;
      };
    };
    memberships: {
      id: string;
      role: string;
      club_id: string;
      profile_id: string;
      phone: string | null;
      contact_email: string | null;
      profiles: {
        id: string;
        full_name: string | null;
        avatar_url: string | null;
      };
    };
  };

  // Filtra por club + valida role membership coherente con cuerpo técnico.
  const rows = (rawStaff ?? [])
    .map((r) => r as unknown as StaffJoin)
    .filter(
      (r) =>
        r.memberships.club_id === clubId &&
        r.teams.categories.club_id === clubId &&
        COACH_ROLES.includes(r.memberships.role as Role)
    );

  // Agrupa por membership_id → CoachRow.
  const byMembership = new Map<string, CoachRow>();
  for (const r of rows) {
    const existing = byMembership.get(r.membership_id);
    const assignment: CoachTeamAssignment = {
      team_staff_id: r.id,
      team_id: r.team_id,
      team_name: r.teams.name,
      team_color: r.teams.color,
      category_id: r.teams.categories.id,
      category_name: r.teams.categories.name,
      category_season: r.teams.season,
      staff_role: r.staff_role,
      joined_at: r.joined_at,
    };
    if (existing) {
      existing.assignments.push(assignment);
    } else {
      byMembership.set(r.membership_id, {
        membership_id: r.membership_id,
        profile_id: r.memberships.profile_id,
        full_name: r.memberships.profiles.full_name ?? '—',
        avatar_url: r.memberships.profiles.avatar_url ?? null,
        club_role: r.memberships.role as
          | 'entrenador_principal'
          | 'entrenador_ayudante',
        assignments: [assignment],
        caps_granted: null,
        phone: (r.memberships.phone as string | null) ?? null,
        contact_email: (r.memberships.contact_email as string | null) ?? null,
      });
    }
  }

  let coaches = [...byMembership.values()];

  // Resumen de capabilities concedidas para ayudantes.
  const assistantIds = coaches
    .filter((c) => c.club_role === 'entrenador_ayudante')
    .map((c) => c.membership_id);
  if (assistantIds.length > 0) {
    const { data: caps } = await supabase
      .from('capabilities')
      .select('membership_id, granted')
      .in('membership_id', assistantIds)
      .eq('granted', true);
    const counts = new Map<string, number>();
    for (const row of caps ?? []) {
      const m = row.membership_id as string;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    for (const c of coaches) {
      if (c.club_role === 'entrenador_ayudante') {
        c.caps_granted = counts.get(c.membership_id) ?? 0;
      }
    }
  }

  // Aplica filtros en memoria. El conjunto es pequeño (< 50 entrenadores
  // típicos por club). Postpone BD-side filtering a F2.11 extension si
  // un club mayor lo exige.
  const term = filters.search.trim().toLowerCase();
  if (term.length > 0) {
    coaches = coaches.filter((c) => c.full_name.toLowerCase().includes(term));
  }

  if (filters.staffRoles.length > 0) {
    const set = new Set<TeamStaffRole>(filters.staffRoles);
    coaches = coaches.filter((c) =>
      c.assignments.some((a) => set.has(a.staff_role))
    );
  }

  if (filters.teamIds.length > 0) {
    const set = new Set(filters.teamIds);
    coaches = coaches.filter((c) =>
      c.assignments.some((a) => set.has(a.team_id))
    );
  }

  if (filters.categoryIds.length > 0) {
    const set = new Set(filters.categoryIds);
    coaches = coaches.filter((c) =>
      c.assignments.some((a) => set.has(a.category_id))
    );
  }

  // Orden estable por apellido/nombre.
  coaches.sort((a, b) =>
    a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' })
  );

  // Ordena assignments por joined_at descendente.
  for (const c of coaches) {
    c.assignments.sort((a, b) => b.joined_at.localeCompare(a.joined_at));
  }

  return {
    coaches,
    total: coaches.length,
    visibleTeams,
    visibleCategories,
    canManage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficha individual del coach
// ─────────────────────────────────────────────────────────────────────────────

export type CoachStaffHistoryRow = {
  team_staff_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  category_name: string;
  category_season: string;
  staff_role: TeamStaffRole;
  joined_at: string;
  left_at: string | null;
};

export type CoachDetail = {
  coach: CoachRow;
  history: CoachStaffHistoryRow[];
  /** Teams del club a los que se puede mover (target del dialog). */
  movableTargets: TeamOption[];
  canManage: boolean;
};

/**
 * Carga la ficha de un coach por membership_id. Devuelve null si no es
 * visible para el user o no pertenece al club activo.
 */
export async function loadCoachDetail(
  clubId: string,
  role: Role,
  membershipId: string
): Promise<CoachDetail | null> {
  const scope = await resolveStaffScope(clubId, role);
  if (scope.kind === 'none') return null;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: m } = await supabase
    .from('memberships')
    .select(
      `id, role, club_id, profile_id, phone, contact_email, profiles!inner(id, full_name, avatar_url)`
    )
    .eq('id', membershipId)
    .maybeSingle();

  if (!m) return null;
  if ((m.club_id as string) !== clubId) return null;
  if (!COACH_ROLES.includes(m.role as Role)) return null;

  type ProfileShape = {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  const profile = m.profiles as unknown as ProfileShape;

  // Histórico completo de team_staff para esta membership.
  type HistRow = {
    id: string;
    staff_role: TeamStaffRole;
    joined_at: string;
    left_at: string | null;
    team_id: string;
    teams: {
      id: string;
      name: string;
      color: string;
      season: string;
      categories: { name: string };
    };
  };

  const { data: rawHist } = await supabase
    .from('team_staff')
    .select(
      `id, staff_role, joined_at, left_at, team_id,
       teams!inner(id, name, color, season, categories!inner(name))`
    )
    .eq('membership_id', membershipId)
    .order('joined_at', { ascending: false });

  const hist = (rawHist ?? []).map((r) => r as unknown as HistRow);
  const history: CoachStaffHistoryRow[] = hist.map((r) => ({
    team_staff_id: r.id,
    team_id: r.team_id,
    team_name: r.teams.name,
    team_color: r.teams.color,
    category_name: r.teams.categories.name,
    category_season: r.teams.season,
    staff_role: r.staff_role,
    joined_at: r.joined_at,
    left_at: r.left_at,
  }));

  const active = hist.filter((r) => r.left_at == null);

  // Si el scope es restricted (principal), exigimos al menos un team en
  // común para mostrar la ficha.
  if (scope.kind === 'restricted') {
    const overlap = active.some((a) => scope.teamIds.includes(a.team_id));
    if (!overlap) return null;
  }

  const assignments: CoachTeamAssignment[] = active.map((a) => ({
    team_staff_id: a.id,
    team_id: a.team_id,
    team_name: a.teams.name,
    team_color: a.teams.color,
    category_id: '', // no se usa en la ficha
    category_name: a.teams.categories.name,
    category_season: a.teams.season,
    staff_role: a.staff_role,
    joined_at: a.joined_at,
  }));

  // Capabilities (solo si ayudante).
  let capsGranted: number | null = null;
  if (m.role === 'entrenador_ayudante') {
    const { data: caps } = await supabase
      .from('capabilities')
      .select('granted')
      .eq('membership_id', membershipId)
      .eq('granted', true);
    capsGranted = (caps ?? []).length;
  }

  const coach: CoachRow = {
    membership_id: m.id as string,
    profile_id: m.profile_id as string,
    full_name: profile.full_name ?? '—',
    avatar_url: profile.avatar_url ?? null,
    club_role: m.role as 'entrenador_principal' | 'entrenador_ayudante',
    assignments,
    caps_granted: capsGranted,
    phone: (m.phone as string | null) ?? null,
    contact_email: (m.contact_email as string | null) ?? null,
  };

  const allTeams = await loadVisibleTeams(clubId, { kind: 'all' });
  const canManage = WRITE_ROLES.includes(role);

  return { coach, history, movableTargets: allTeams, canManage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusables
// ─────────────────────────────────────────────────────────────────────────────

export { TEAM_STAFF_ROLES };
export type { TeamStaffRole };
