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
