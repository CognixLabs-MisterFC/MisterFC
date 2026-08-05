/**
 * O2-11a-2 — Lectura CLUB-WIDE del cuerpo técnico para la banda de DIRECCIÓN
 * (nativa).
 *
 * La web resuelve el directorio en `cuerpo-tecnico/queries.ts` (`loadCoachList`),
 * un motor de scope+filtros+gestión (mover staff) que la app de dirección NO
 * necesita: dirección es club-wide (admin_club·director; gate = `AreaGuard('direction')`)
 * y SOLO LECTURA (mover staff se queda en web). Por eso esto es una lectura NUEVA y
 * fina, no un wrapper de aquel motor.
 *
 * Enumera el cuerpo técnico ACTIVO del club (`team_staff.left_at IS NULL`) cuyo rol
 * de membresía es de entrenador (COACH_ROLES: principal·ayudante), agrupado por
 * membresía y con sus asignaciones (equipo·rol de staff). Filtra por club por las
 * dos vías (memberships.club_id y teams→categories.club_id). La RLS
 * `team_staff_select_member` deja leerlo; el candado de la banda es el AreaGuard.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { COACH_ROLES } from '../auth/roles';
import type { Role } from '../auth/current-user';
import type { TeamStaffRole } from '../schemas/staff';

type DbClient = SupabaseClient<Database>;

export type ClubStaffAssignment = {
  teamStaffId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  staffRole: TeamStaffRole;
  joinedAt: string;
};

export type ClubStaffRow = {
  membershipId: string;
  profileId: string;
  fullName: string;
  clubRole: 'entrenador_principal' | 'entrenador_ayudante';
  assignments: ClubStaffAssignment[];
};

export async function getClubStaffFromClient(
  supabase: DbClient,
  clubId: string
): Promise<ClubStaffRow[]> {
  const { data } = await supabase
    .from('team_staff')
    .select(
      `id, staff_role, joined_at, team_id, membership_id,
       teams!inner(id, name, color, categories!inner(club_id)),
       memberships!inner(id, role, club_id, profile_id, profiles!inner(id, full_name))`
    )
    .is('left_at', null);

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
      categories: { club_id: string };
    };
    memberships: {
      id: string;
      role: string;
      club_id: string;
      profile_id: string;
      profiles: { id: string; full_name: string | null };
    };
  };

  const rows = (data ?? [])
    .map((r) => r as unknown as StaffJoin)
    .filter(
      (r) =>
        r.memberships.club_id === clubId &&
        r.teams.categories.club_id === clubId &&
        COACH_ROLES.includes(r.memberships.role as Role)
    );

  const byMembership = new Map<string, ClubStaffRow>();
  for (const r of rows) {
    const assignment: ClubStaffAssignment = {
      teamStaffId: r.id,
      teamId: r.team_id,
      teamName: r.teams.name,
      teamColor: r.teams.color,
      staffRole: r.staff_role,
      joinedAt: r.joined_at,
    };
    const existing = byMembership.get(r.membership_id);
    if (existing) {
      existing.assignments.push(assignment);
    } else {
      byMembership.set(r.membership_id, {
        membershipId: r.membership_id,
        profileId: r.memberships.profile_id,
        fullName: r.memberships.profiles.full_name ?? '—',
        clubRole: r.memberships.role as
          | 'entrenador_principal'
          | 'entrenador_ayudante',
        assignments: [assignment],
      });
    }
  }

  const coaches = [...byMembership.values()];
  for (const c of coaches) {
    c.assignments.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  }
  coaches.sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' })
  );
  return coaches;
}
