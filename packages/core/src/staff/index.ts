/**
 * O2-16 — API pública de tareas pendientes del cuerpo técnico (coach-scoped).
 */
export {
  listStaffTrainingsWithoutAttendanceFromClient,
  listStaffTrainingsWithoutSessionFromClient,
} from './pending-trainings';
export type { StaffPendingTraining } from './pending-trainings';
