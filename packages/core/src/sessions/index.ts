/**
 * F12 — API pública del módulo de SESIONES (planificador de entrenamiento).
 */

export {
  SESSION_BLOCK_TYPES,
  DEFAULT_SESSION_SKELETON,
  SESSION_VISIBILITIES,
  buildDefaultSkeleton,
  isSessionBlockType,
  isSessionVisibility,
  type SessionBlockType,
  type SessionVisibility,
  type SeededBlock,
} from './sessions';

export {
  sessionBlockTypeSchema,
  sessionVisibilitySchema,
  sessionHeaderSchema,
  sessionTaskSchema,
  sessionBlockSchema,
  createSessionSchema,
  updateSessionHeaderSchema,
  toSessionHeaderColumns,
  type SessionHeaderInput,
  type SessionTaskInput,
  type SessionBlockInput,
  type CreateSessionInput,
  type UpdateSessionHeaderInput,
  type SessionHeaderColumns,
} from './session-form';
