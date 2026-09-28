import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { STAFF_ROLES } from '../auth/roles';

type DbClient = SupabaseClient<Database>;

/** Alguien del club al que se le puede dar una función en un equipo. */
export type StaffCandidate = {
  membershipId: string;
  fullName: string;
  clubRole: Role;
};

/**
 * W-3 — A QUIÉN se puede añadir al cuerpo técnico de un equipo: los miembros del
 * club que no son jugadores.
 *
 * Bajada de `equipos/[teamId]/page.tsx`, donde la consulta estaba a mano. Ahora la
 * comparten la web y la app, que es el único modo de que las dos ofrezcan la misma
 * gente.
 *
 * OJO — NO sirve `getClubStaffFromClient` para esto, y es un error fácil de cometer:
 * esa lectura arranca desde `team_staff`, así que solo ve a quien YA tiene una
 * asignación, y además limita el rol de club a principal y ayudante. Aquí hace falta
 * lo contrario: todas las membresías de staff del club, **incluida la gente sin
 * ningún equipo**, que es justo el caso que hay que poder resolver desde la ficha de
 * un equipo.
 *
 * TAMPOCO se excluye a quien ya es staff de este equipo, a propósito y como en la
 * web: el sistema admite dos funciones en el mismo equipo (UNIQUE de C-0 sobre
 * team_id + membership_id + staff_role), y si se repite la misma la escritura
 * responde `role_exists`, que es un mensaje mucho más claro que una ausencia en un
 * desplegable.
 *
 * El gate es la RLS `memberships_select_*`; esto no decide permisos.
 */
export async function getStaffCandidatesFromClient(
  supabase: DbClient,
  clubId: string,
  /** Sumidero de errores del llamante (la nativa manda a Sentry), como el resto de core. */
  onError?: (err: unknown) => void,
): Promise<StaffCandidate[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('id, role, profiles!inner(full_name)')
    .eq('club_id', clubId)
    .is('left_at', null);
  if (error) onError?.(error);

  type Row = { id: string; role: string; profiles: { full_name: string | null } };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => (STAFF_ROLES as readonly string[]).includes(r.role))
    .map((r) => ({
      membershipId: r.id,
      fullName: r.profiles.full_name ?? '—',
      clubRole: r.role as Role,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));
}

/**
 * W-3 — los equipos que el usuario COORDINA, o `null` si la pregunta no aplica.
 *
 * `null` no es "ninguno": significa "no hace falta recortar" (admin_club/director
 * asignan en todo el club). Es la misma convención que espera
 * `assignmentTargetTeamIds`, y la que ya usaba la web a mano
 * (`role === 'coordinador' ? await loadCoordinatedTeamIds(clubId) : null`).
 *
 * Mismo criterio que la función SQL `user_coordinates_team`: fila viva de
 * `team_staff` con `staff_role = 'coordinador'`. Si la lectura falla se devuelve
 * lista VACÍA y no `null`: null abriría el recorte entero.
 */
export async function getCoordinatedTeamIdsFromClient(
  supabase: DbClient,
  params: { membershipId: string; role: Role | null | undefined },
  onError?: (err: unknown) => void,
): Promise<string[] | null> {
  if (params.role !== 'coordinador') return null;

  const { data, error } = await supabase
    .from('team_staff')
    .select('team_id')
    .eq('membership_id', params.membershipId)
    .eq('staff_role', 'coordinador')
    .is('left_at', null);
  if (error) {
    onError?.(error);
    return [];
  }
  return (data ?? []).map((r) => r.team_id);
}
