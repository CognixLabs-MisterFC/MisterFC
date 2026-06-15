/**
 * F11 — API pública del módulo de ejercicios (vocabularios + estados).
 */

export {
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  METHODOLOGY_STATUSES,
  isTacticalObjective,
  isTechnicalObjective,
  isMethodologyStatus,
} from './exercises';
export type {
  TacticalObjective,
  TechnicalObjective,
  ExerciseIntensity,
  ExerciseSpaceType,
  MethodologyStatus,
} from './exercises';
