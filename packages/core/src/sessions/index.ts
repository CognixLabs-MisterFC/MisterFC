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
  addBlockTaskSchema,
  updateBlockTaskSchema,
  toTaskOverrideColumns,
  blockTaskIdSchema,
  reorderBlocksSchema,
  reorderTasksSchema,
  moveTaskSchema,
  sumTaskMinutes,
  type SessionHeaderInput,
  type SessionTaskInput,
  type SessionBlockInput,
  type CreateSessionInput,
  type UpdateSessionHeaderInput,
  type SessionHeaderColumns,
  type AddBlockTaskInput,
  type UpdateBlockTaskInput,
  type TaskOverrideColumns,
  type BlockTaskIdInput,
  type ReorderBlocksInput,
  type ReorderTasksInput,
  type MoveTaskInput,
} from './session-form';
