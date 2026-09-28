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

  const coordinados = new Set((data ?? []).map((r) => r.team_id));
  // La intersección se hace contra `todos`, que ya viene filtrado por TEMPORADA
  // ACTIVA: una fila `team_staff` viva en el equipo del año pasado (mismo nombre,
  // otro team_id) no debe colarse como destino.
  return todos.filter((t) => coordinados.has(t.teamId));
}
