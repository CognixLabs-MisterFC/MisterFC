/**
 * F7 (mejora) — API pública de cálculo de asistencia.
 */
export {
  isAttendedCode,
  workweekRange,
  trainingsInMatchWeek,
  computeWeeklyTrainingAttendance,
} from './weekly-training';
export type {
  TrainingDay,
  AttendanceMark,
  WeeklyAttendance,
} from './weekly-training';
export {
  attendanceStatsWindow,
  getAttendanceStatsFromClient,
  getPlayerTrainingAttendanceForEventsFromClient,
} from './stats-queries';
export type {
  AttendanceStatsScope,
  AttendancePlayerStat,
  AttendanceCodeBucket,
  AttendanceStatsResult,
  AttendanceStatsRange,
} from './stats-queries';

// O2-7a — scope + lectura + escritura de asistencia para el STAFF (pasar lista).
export { resolveAttendanceScopeFromClient } from './scope';
export type { AttendanceScope } from './scope';
export {
  getRecentTrainingsFromClient,
  getEventAttendanceFromClient,
} from './staff-queries';
export type {
  StaffTrainingEvent,
  AttendanceRecord,
  AttendanceRosterPlayer,
  EventAttendanceData,
} from './staff-queries';
export {
  markAttendanceFromClient,
  clearAttendanceFromClient,
} from './staff-writes';
export type {
  MarkAttendanceError,
  MarkAttendanceOutcome,
  ClearAttendanceOutcome,
} from './staff-writes';
