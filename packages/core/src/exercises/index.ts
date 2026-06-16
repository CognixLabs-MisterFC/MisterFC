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

// F11.6 — Formulario de ejercicio (schema + lógica pura de guardado).
export {
  EXERCISE_FORM_ACTIONS,
  statusForAction,
  exerciseFormSchema,
  createExerciseSchema,
  toExerciseColumns,
} from './exercise-form';
export type {
  ExerciseFormAction,
  ExerciseFormInput,
  CreateExerciseInput,
  ExerciseColumns,
} from './exercise-form';
