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
} from './stats-queries';
export type {
  AttendanceStatsScope,
  AttendancePlayerStat,
  AttendanceCodeBucket,
  AttendanceStatsResult,
  AttendanceStatsRange,
} from './stats-queries';
