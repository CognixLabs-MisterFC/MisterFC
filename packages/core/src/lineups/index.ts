/**
 * F6 — API pública del módulo de alineaciones (catálogo + geometría + tipos).
 */

export type {
  TeamFormat,
  SlotRole,
  FormationSlot,
  Formation,
  LineupLocation,
  OutReason,
  PositionAssignment,
} from './types';
export { LINEUP_LOCATIONS, OUT_REASONS } from './types';

export {
  FORMATIONS,
  getFormation,
  formationsForFormat,
  defaultFormation,
} from './formations';

export {
  roleFromPosition,
  remapToFormation,
  fieldCapacity,
} from './geometry';
export type {
  PlayerPositionMain,
  FieldPlayerInput,
  SlottedPlayer,
  RemapResult,
} from './geometry';

export {
  FIELD_SLOT_PREFIX,
  PLAYER_DRAG_PREFIX,
  BENCH_ZONE_ID,
  OUT_ZONE_ID,
  fieldSlotDroppableId,
  playerDraggableId,
  parseFieldSlotId,
  parsePlayerDragId,
  resolveDrop,
  applyDrop,
  callupDecisionForLocation,
} from './editor';
export type { DropTarget, ResolvedDrop, ApplyDropResult } from './editor';

export {
  MODALITY_RULES,
  modalityRules,
  startersFor,
  maxCalledUpFor,
  calledUpOverflow,
} from './rules';
export type { ModalityRules } from './rules';
