/**
 * Miembros del club (4e-1) — lectura de las memberships del club agrupadas por
 * segmento, para la pantalla de gestión (baja/reactivar).
 *
 * PR1 (4d+4e-1): segmentos DIRECCIÓN (admin_club, director) y CUERPO TÉCNICO
 * (coordinador, entrenadores), SOLO ACTIVOS (left_at is null). Familias (tutores)
 * y el toggle de bajas llegan en 4e-2/4e-3.
 *
 * RLS: `memberships_select_clubmate` deja a un admin/director ACTIVO leer todas las
 * memberships del club (la policy mira el rol del que MIRA). El gate de la pantalla es
 * el guard server-side de la página + el nav.
 *
 * IMPORTANTE: NO se selecciona `left_reason`. La razón es nota interna del club y no
 * viaja al cliente en ningún caso (ni aquí ni en la RPC de aviso al dado de baja).
 */

import {
  createSupabaseServerClient,
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
};

export type ClubMembersResult = {
  direccion: ClubMemberRow[];
  cuerpoTecnico: ClubMemberRow[];
};

/**
 * Carga los miembros ACTIVOS de dirección y cuerpo técnico del club. Conjuntos
 * pequeños → sin paginación (a diferencia de Familias, que llega en 4e-2).
 */
export async function loadClubMembers(
  clubId: string
): Promise<ClubMembersResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const roles = [...DIRECCION_ROLES, ...CUERPO_TECNICO_ROLES];

  const { data } = await supabase
    .from('memberships')
    .select('id, role, club_id, profile_id, profiles!inner(id, full_name, avatar_url)')
    .eq('club_id', clubId)
    .is('left_at', null)
    .in('role', roles as string[]);

  type Row = {
    id: string;
    role: Role;
    club_id: string;
    profile_id: string;
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
      })
    );

  const sortInGroup = (a: ClubMemberRow, b: ClubMemberRow) => {
    const byRole = (ROLE_ORDER[a.club_role] ?? 99) - (ROLE_ORDER[b.club_role] ?? 99);
    if (byRole !== 0) return byRole;
    return a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' });
  };

  const direccionSet = new Set<string>(DIRECCION_ROLES);
  return {
    direccion: rows.filter((r) => direccionSet.has(r.club_role)).sort(sortInGroup),
    cuerpoTecnico: rows
      .filter((r) => !direccionSet.has(r.club_role))
      .sort(sortInGroup),
  };
}
