import type { Role } from '../auth/current-user';
import { ADMIN_ROLES } from '../auth/roles';
import { TEAM_STAFF_ROLES, type TeamStaffRole } from '../schemas/staff';

/**
 * W-2 — QUIÉN puede agregar un rol de equipo a alguien que ya está en el club, CON
 * QUÉ funciones y SOBRE QUÉ equipos.
 *
 * La escritura ya vive en core desde W-1 (`assignStaffToTeam`). Lo que seguía
 * repartido por `apps/web` era el permiso, y en tres sitios distintos:
 *
 *   · quién            `canManage = WRITE_ROLES.includes(role)`   (cuerpo-tecnico/queries.ts)
 *   · con qué roles    `role === 'coordinador' ? sin 'coordinador' : todos`  (page.tsx)
 *   · a qué equipos    `visibleTeams`, que sale de `resolveStaffScope`        (queries.ts)
 *
 * Esto lo junta en UNA función pura para que la pantalla nativa no lo vuelva a
 * deducir a mano. El motivo no es estético: al medirlo para W-2, el comentario que
 * encabeza `addStaffAssignment` decía «la UI solo lo ofrece a admin/director
 * (coordinador NO asigna en C-0)», y eso YA ERA FALSO — C-2c le dio la acción al
 * coordinador con la lista de funciones recortada. Quien portara la pantalla
 * leyendo ese comentario habría construido el candado equivocado.
 *
 * Esto NO es el gate de seguridad: quien decide es la RLS `team_staff_insert_admin`,
 * que corre con el cliente del usuario tanto en la Server Action de la web como en el
 * endpoint de la nativa. Esto decide qué se OFRECE. Y por eso mismo se ha escrito
 * mirando la policy, no mirando la web:
 *
 *     or (
 *       public.user_coordinates_team(team_staff.team_id)
 *       and team_staff.staff_role = any (array['entrenador_principal',
 *         'entrenador_ayudante', 'preparador_fisico', 'delegado'])
 *     )
 *
 * `user_coordinates_team` es `team_staff.staff_role = 'coordinador'` para ESE equipo.
 * O sea que al coordinador la RLS le deja insertar SOLO en los equipos que COORDINA.
 *
 * La web decía lo contrario en DOS comentarios —que acotar a los coordinados era
 * «una regla del movimiento, E-final-2, no de la asignación», y que `movableTargets`
 * «ya estaba acotado» cuando el acotado era `moveTargets`— y le ofrecía al
 * coordinador equipos que el INSERT rechazaba con 42501. W-2b lo corrige: sus dos
 * pantallas piden los destinos a `assignmentTargetTeamIds`, el mismo que usa la app.
 */

/** De dónde tiene que sacar la pantalla los equipos que ofrece como destino. */
export type AssignmentTeamSource =
  /** Nada que ofrecer: esta persona no agrega roles. */
  | 'none'
  /** Todos los equipos del club en temporada activa (`getClubTeamsFromClient`). */
  | 'all_club_teams'
  /** Solo los equipos que COORDINA, que es lo que la RLS le acepta. */
  | 'own_coordinated_teams';

export type StaffAssignmentPermission = {
  canAssign: boolean;
  /** Funciones ofrecidas en el selector. Vacío si no puede agregar. */
  roles: readonly TeamStaffRole[];
  teamSource: AssignmentTeamSource;
};

const NADA: StaffAssignmentPermission = {
  canAssign: false,
  roles: [],
  teamSource: 'none',
};

export function staffAssignmentPermission(
  role: Role | null | undefined,
): StaffAssignmentPermission {
  if (role == null) return NADA;

  // Se pregunta primero a la lista de core (regla anti-deriva de `auth/roles.ts`:
  // no se redefinen estas familias en cada pantalla).
  if (!ADMIN_ROLES.includes(role)) return NADA;

  // Y DESPUÉS se clasifica rol por rol, a propósito. Si algún día entra un rol nuevo
  // en ADMIN_ROLES, cae aquí y se queda SIN la acción hasta que alguien decida qué
  // equipos le tocan. Falla cerrado: el fallo es que no se ofrece, no que se ofrezca
  // de más.
  switch (role) {
    case 'admin_club':
    case 'director':
      return { canAssign: true, roles: TEAM_STAFF_ROLES, teamSource: 'all_club_teams' };
    case 'coordinador':
      // C-2c — no nombra coordinadores. La RLS C-1d ya lo bloquea; esto evita
      // ofrecerle una opción que el servidor le va a negar.
      return {
        canAssign: true,
        roles: TEAM_STAFF_ROLES.filter((r) => r !== 'coordinador'),
        teamSource: 'own_coordinated_teams',
      };
    default:
      return NADA;
  }
}
