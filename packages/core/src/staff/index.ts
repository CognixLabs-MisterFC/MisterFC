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
