import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { getClubTeamsFromClient, type ClubTeamCard } from '../team-view/queries';
import { staffAssignmentPermission } from './assignment-policy';

type DbClient = SupabaseClient<Database>;

/**
 * W-2 — los equipos que se le pueden OFRECER a esta persona como destino al agregar
 * un rol, ya resueltos según su rol de club.
 *
 * Una sola llamada para la pantalla, con la decisión dentro: así la nativa no tiene
 * que saber que un director lee `getClubTeamsFromClient` y un coordinador no. Ver
 * `assignment-policy.ts` para el por qué de cada rama, incluida la discrepancia con
 * la web.
 *
 * Es una lectura de OFERTA, no un gate: el permiso lo pone la RLS
 * `team_staff_insert_admin` en el INSERT. Lo que hace esto es no ofrecer opciones que
 * el servidor va a rechazar.
 */
/**
 * W-2b — el RECORTE, puro y sin base de datos: de una lista de equipos visibles,
 * cuáles se pueden ofrecer como destino.
 *
 * Existe para que la web y la app no puedan discrepar. La lectura de la app
 * (`getAssignmentTargetTeamsFromClient`, más abajo) delega aquí, y las dos pantallas
 * de la web —que ya tienen los datos cargados— llaman a esto mismo. Antes de W-2b
 * cada superficie decidía por su cuenta y las dos decidían mal.
 *
 * `coordinatedTeamIds` es null cuando NO aplica (admin/director). Si llega null
 * siendo coordinador, se devuelve vacío: no se puede resolver qué coordina, así que
 * no se le ofrece nada. Falla cerrado.
 */
export function assignmentTargetTeamIds(
  role: Role | null | undefined,
  visibleTeamIds: readonly string[],
  coordinatedTeamIds: readonly string[] | null,
): string[] {
  const { teamSource } = staffAssignmentPermission(role);
  if (teamSource === 'none') return [];
  if (teamSource === 'all_club_teams') return [...visibleTeamIds];
  if (coordinatedTeamIds === null) return [];
  const coordina = new Set(coordinatedTeamIds);
  return visibleTeamIds.filter((id) => coordina.has(id));
}

export async function getAssignmentTargetTeamsFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    /**
     * La membresía de QUIEN MIRA, no la de la persona a la que se le va a dar el
     * rol. Sirve para saber qué equipos coordina. La otra —la del destino— es la
     * que viaja a `assignStaffToTeam`. Se llaman distinto a propósito: son dos
     * UUID del mismo tipo y confundirlos no daría ningún error de tipos.
     */
    viewerMembershipId: string;
    role: Role | null | undefined;
  },
  /** Sumidero de errores del llamante (la nativa manda a Sentry), como el resto de core. */
  onError?: (err: unknown) => void,
): Promise<ClubTeamCard[]> {
  const { teamSource } = staffAssignmentPermission(params.role);
  if (teamSource === 'none') return [];

  const todos = await getClubTeamsFromClient(supabase, params.clubId);
  if (teamSource === 'all_club_teams') return todos;

  // Coordinador: solo los que coordina. Mismo criterio que `user_coordinates_team`
  // (staff_role = 'coordinador' y fila viva), que es lo que la RLS va a comprobar.
  const { data, error } = await supabase
    .from('team_staff')
    .select('team_id')
    .eq('membership_id', params.viewerMembershipId)
    .eq('staff_role', 'coordinador')
    .is('left_at', null);
  if (error) {
    onError?.(error);
    // Sin poder resolver qué coordina, NO se ofrece nada. Un fallo de lectura no
    // puede convertirse en "ofrécele todo el club".
    return [];
  }

  // El recorte lo decide `assignmentTargetTeamIds`, el MISMO que usan las dos
  // pantallas de la web (W-2b). Aquí solo se le da lo que ha leído.
  //
  // Se le pasan los ids de `todos`, que ya viene filtrado por TEMPORADA ACTIVA: una
  // fila `team_staff` viva en el equipo del año pasado (mismo nombre, otro team_id)
  // no debe colarse como destino.
  const permitidos = new Set(
    assignmentTargetTeamIds(
      params.role,
      todos.map((t) => t.teamId),
      (data ?? []).map((r) => r.team_id),
    ),
  );
  return todos.filter((t) => permitidos.has(t.teamId));
}
