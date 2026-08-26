/**
 * Miembros del club — lectura de las memberships del club para la pantalla de gestión
 * (baja/reactivar), en tres segmentos: DIRECCIÓN (admin_club, director), CUERPO TÉCNICO
 * (coordinador, entrenadores) y FAMILIAS (tutores, rol jugador).
 *
 * RLS: `memberships_select_clubmate` deja a un admin/director ACTIVO leer todas las
 * memberships del club (incluidas las de baja: la policy mira el rol del que MIRA). El
 * gate de la pantalla es el guard server-side de la página + el nav.
 *
 * IMPORTANTE: NO se selecciona `left_reason`. La razón es nota interna del club y no
 * viaja al cliente en ningún caso.
 *
 * Familias es el conjunto grande (cientos). Estrategia (4e-2): índice LIGERO en memoria
 * (solo id + nombre + left_at) para poder buscar INSENSIBLE A ACENTOS (foldForSearch,
 * imposible server-side sin `unaccent`) y paginar; se HIDRATAN hijos+equipo SOLO de las
 * ~50 filas de la página. Lo pesado (hijos/equipo) nunca se trae para todos.
 */

import {
  createSupabaseServerClient,
  foldForSearch,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/** Roles de cada segmento (orden de aparición dentro del grupo). */
export const DIRECCION_ROLES: readonly Role[] = ['admin_club', 'director'];
export const CUERPO_TECNICO_ROLES: readonly Role[] = [
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export const FAMILIES_PAGE_SIZE = 50;

const ROLE_ORDER: Record<string, number> = {
  admin_club: 0,
  director: 1,
  coordinador: 2,
  entrenador_principal: 3,
  entrenador_ayudante: 4,
};

export type ClubMemberRow = {
  membership_id: string;
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  club_role: Role;
  /** null = ACTIVO; fecha (YYYY-MM-DD) = de baja desde. NUNCA se expone left_reason. */
  left_at: string | null;
};

export type ClubMembersResult = {
  direccion: ClubMemberRow[];
  cuerpoTecnico: ClubMemberRow[];
};

/** Un hijo vinculado al tutor, con su equipo actual (o null si no tiene). */
export type FamilyChild = {
  player_id: string;
  name: string;
  team_name: string | null;
};

export type FamilyRow = {
  membership_id: string;
  profile_id: string;
  full_name: string;
  left_at: string | null;
  children: FamilyChild[];
};

export type FamiliesResult = {
  rows: FamilyRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Activo primero, luego por orden de rol, luego por nombre. */
function sortMembers(a: ClubMemberRow, b: ClubMemberRow): number {
  const byActive = Number(a.left_at != null) - Number(b.left_at != null);
  if (byActive !== 0) return byActive;
  const byRole = (ROLE_ORDER[a.club_role] ?? 99) - (ROLE_ORDER[b.club_role] ?? 99);
  if (byRole !== 0) return byRole;
  return a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' });
}

/**
 * Carga los miembros de dirección y cuerpo técnico del club. Conjuntos pequeños → sin
 * paginación. `includeLeft` (toggle "Incluir bajas") decide si se traen también las
 * bajas; por defecto solo activos.
 */
export async function loadClubMembers(
  clubId: string,
  includeLeft: boolean
): Promise<ClubMembersResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const roles = [...DIRECCION_ROLES, ...CUERPO_TECNICO_ROLES];

  let q = supabase
    .from('memberships')
    .select('id, role, club_id, profile_id, left_at, profiles!inner(id, full_name, avatar_url)')
    .eq('club_id', clubId)
    .in('role', roles as string[]);
  if (!includeLeft) q = q.is('left_at', null);

  const { data } = await q;

  type Row = {
    id: string;
    role: Role;
    club_id: string;
    profile_id: string;
    left_at: string | null;
    profiles: { id: string; full_name: string | null; avatar_url: string | null };
  };

  const rows = (data ?? [])
    .map((r) => r as unknown as Row)
    .filter((r) => r.club_id === clubId)
    .map(
      (r): ClubMemberRow => ({
        membership_id: r.id,
        profile_id: r.profile_id,
        full_name: r.profiles.full_name ?? '—',
        avatar_url: r.profiles.avatar_url ?? null,
        club_role: r.role,
        left_at: r.left_at,
      })
    );

  const direccionSet = new Set<string>(DIRECCION_ROLES);
  return {
    direccion: rows.filter((r) => direccionSet.has(r.club_role)).sort(sortMembers),
    cuerpoTecnico: rows
      .filter((r) => !direccionSet.has(r.club_role))
      .sort(sortMembers),
  };
}

/** Recuento total de tutores del club (para el contador del segmento Familias). */
export async function countFamilies(
  clubId: string,
  includeLeft: boolean
): Promise<number> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  let q = supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('role', 'jugador');
  if (!includeLeft) q = q.is('left_at', null);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Carga una página de FAMILIAS (tutores). Índice ligero (id+nombre+left_at) para buscar
 * insensible a acentos y paginar; hidrata hijos+equipo SOLO de la página.
 */
export async function loadFamilies(
  clubId: string,
  opts: { search: string; page: number; includeLeft: boolean }
): Promise<FamiliesResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ── Índice ligero: todos los tutores del club, solo id + nombre + left_at ──────────
  let idxQ = supabase
    .from('memberships')
    .select('id, profile_id, left_at, club_id, profiles!inner(full_name)')
    .eq('club_id', clubId)
    .eq('role', 'jugador');
  if (!opts.includeLeft) idxQ = idxQ.is('left_at', null);
  const { data: idxData } = await idxQ;

  type IdxRow = {
    id: string;
    profile_id: string;
    left_at: string | null;
    club_id: string;
    profiles: { full_name: string | null };
  };

  let index = (idxData ?? [])
    .map((r) => r as unknown as IdxRow)
    .filter((r) => r.club_id === clubId)
    .map((r) => ({
      membership_id: r.id,
      profile_id: r.profile_id,
      full_name: r.profiles.full_name ?? '—',
      left_at: r.left_at,
    }));

  // Búsqueda INSENSIBLE A ACENTOS (foldForSearch en término y texto).
  const term = foldForSearch(opts.search.trim());
  if (term.length > 0) {
    index = index.filter((r) => foldForSearch(r.full_name).includes(term));
  }

  index.sort((a, b) => {
    const byActive = Number(a.left_at != null) - Number(b.left_at != null);
    if (byActive !== 0) return byActive;
    return a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' });
  });

  const total = index.length;
  const page = Math.max(1, opts.page);
  const from = (page - 1) * FAMILIES_PAGE_SIZE;
  const pageIndex = index.slice(from, from + FAMILIES_PAGE_SIZE);

  // ── Hidratación: hijos + equipo SOLO de los ~50 de la página ──────────────────────
  const childrenByProfile = await hydrateChildren(
    supabase,
    clubId,
    pageIndex.map((r) => r.profile_id)
  );

  const rows: FamilyRow[] = pageIndex.map((r) => ({
    membership_id: r.membership_id,
    profile_id: r.profile_id,
    full_name: r.full_name,
    left_at: r.left_at,
    children: childrenByProfile.get(r.profile_id) ?? [],
  }));

  return { rows, total, page, pageSize: FAMILIES_PAGE_SIZE };
}

/**
 * Para un conjunto de perfiles (tutores), resuelve sus hijos vinculados
 * (player_accounts → players del club) y el equipo ACTUAL de cada uno
 * (team_members activo → teams). Devuelve profile_id → hijos.
 */
async function hydrateChildren(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  clubId: string,
  profileIds: string[]
): Promise<Map<string, FamilyChild[]>> {
  const out = new Map<string, FamilyChild[]>();
  if (profileIds.length === 0) return out;

  const { data: paData } = await supabase
    .from('player_accounts')
    .select('player_id, profile_id')
    .in('profile_id', profileIds);
  const pa = (paData ?? []) as { player_id: string; profile_id: string }[];
  if (pa.length === 0) return out;

  const playerIds = [...new Set(pa.map((r) => r.player_id))];

  const { data: playersData } = await supabase
    .from('players')
    .select('id, first_name, last_name, club_id')
    .in('id', playerIds);
  const players = new Map<string, { name: string }>();
  for (const p of (playersData ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    club_id: string;
  }[]) {
    if (p.club_id !== clubId) continue;
    players.set(
      p.id,
      { name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—' }
    );
  }

  // Equipo ACTUAL de cada jugador (team_members activo). Un jugador podría no tener.
  const { data: tmData } = await supabase
    .from('team_members')
    .select('player_id, team_id, teams!inner(id, name)')
    .in('player_id', playerIds)
    .is('left_at', null);
  const teamByPlayer = new Map<string, string>();
  for (const r of (tmData ?? []) as unknown as {
    player_id: string;
    teams: { name: string };
  }[]) {
    if (!teamByPlayer.has(r.player_id)) teamByPlayer.set(r.player_id, r.teams.name);
  }

  for (const link of pa) {
    const player = players.get(link.player_id);
    if (!player) continue; // jugador de otro club o borrado
    const list = out.get(link.profile_id) ?? [];
    list.push({
      player_id: link.player_id,
      name: player.name,
      team_name: teamByPlayer.get(link.player_id) ?? null,
    });
    out.set(link.profile_id, list);
  }

  // Orden estable de los hijos por nombre.
  for (const [, list] of out) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }
  return out;
}
