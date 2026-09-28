/**
 * O2-16 — API pública de tareas pendientes del cuerpo técnico (coach-scoped).
 */
export {
  listStaffTrainingsWithoutAttendanceFromClient,
  listStaffTrainingsWithoutSessionFromClient,
} from './pending-trainings';
export type { StaffPendingTraining } from './pending-trainings';

/**
 * W-1 — dar una función en un equipo a alguien que ya está en el club. Bajada de
 * `apps/web/src/lib/team-staff.ts`: la piden dos server actions de la web y, desde la
 * serie W, también la pantalla nativa. Y en `apps/web` no la probaba nadie.
 */
export { assignStaffToTeam } from './team-assignment';
export type { AssignStaffError, AssignStaffResult } from './team-assignment';

/**
 * W-2 — y el PERMISO de esa asignación: quién la ofrece, con qué funciones y de qué
 * lista de equipos. Estaba repartido en tres sitios de `apps/web`, y uno de sus
 * comentarios ya mentía. Ver `assignment-policy.ts`.
 */
export { staffAssignmentPermission } from './assignment-policy';
export type { AssignmentTeamSource, StaffAssignmentPermission } from './assignment-policy';
export { getAssignmentTargetTeamsFromClient } from './assignment-targets';
export { assignmentTargetTeamIds } from './assignment-targets';

/**
 * W-3 — añadir staff a un equipo (la persona se elige, el equipo viene fijo). Mismo
 * `assignStaffToTeam` de W-1 y el MISMO endpoint que W-2; lo nuevo es a quién se
 * ofrece y si sale el botón.
 */
export { canAssignStaffToTeam } from './assignment-targets';
export {
  getStaffCandidatesFromClient,
  getCoordinatedTeamIdsFromClient,
} from './candidates';
export type { StaffCandidate } from './candidates';

/**
 * W-4 — nombre y contacto de un miembro. SIN endpoint: el permiso vive dentro de los
 * dos RPC SECURITY DEFINER, que se invocan como el usuario. Y OJO, el permiso NO es
 * el de asignar: aquí el coordinador NO entra (ver `identity.ts`).
 */
export {
  STAFF_NAME_MAX,
  canEditStaffIdentity,
  canEditStaffIdentityOf,
  getStaffContactFromClient,
  staffContactInput,
  staffNameInput,
  updateStaffContactFromClient,
  updateStaffNameFromClient,
} from './identity';
export type {
  ContactError,
  NameError,
  StaffContact,
  StaffContactError,
  StaffIdentityError,
  StaffIdentityResult,
  StaffNameError,
} from './identity';

/**
 * W-5 — vincular un jugador a un miembro (hijo o tutelado). SIN endpoint: la tabla
 * `player_accounts` tiene su gate en la RLS, y la app escribe con su propia sesión
 * como la web con su cookie. Y OJO con el permiso: la policy admite también al
 * coordinador para los jugadores de sus equipos, pero `canLinkPlayers` lo deja fuera
 * a propósito porque su lista de candidatos NO viene recortada (ver `player-links.ts`).
 */
export {
  PLAYER_LINK_RELATIONS,
  canLinkPlayers,
  getMemberPlayerLinksFromClient,
  linkPlayerToMember,
} from './player-links';
export type {
  LinkPlayerError,
  LinkPlayerResult,
  LinkedPlayer,
  LinkedPlayerRelation,
  MemberPlayerLinks,
  PlayerLinkCandidate,
  PlayerLinkRelation,
} from './player-links';
