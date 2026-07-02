/**
 * F6 — API pública del módulo de alineaciones (catálogo + geometría + tipos).
 */

export type {
  TeamFormat,
  SlotRole,
  FormationSlot,
  Formation,
  LineupLocation,
  PositionAssignment,
} from './types';
export { LINEUP_LOCATIONS } from './types';

export {
  FORMATIONS,
  getFormation,
  formationsForFormat,
  defaultFormation,
  defaultLineupDraft,
  DEFAULT_LINEUP_NAME,
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
  fieldSlotDroppableId,
  playerDraggableId,
  parseFieldSlotId,
  parsePlayerDragId,
  resolveDrop,
  applyDrop,
} from './editor';
export type { DropTarget, ResolvedDrop, ApplyDropResult } from './editor';

export {
  MODALITY_RULES,
  modalityRules,
  startersFor,
  maxCalledUpFor,
  calledUpOverflow,
  calledUpLimitApplies,
  exceedsStarters,
} from './rules';
export type { ModalityRules } from './rules';

export {
  positionsFromFormation,
  blankFormationPositions,
  clampPct,
  placeOnFormation,
  coachFormationToFormation,
  positionKeyOfSlotCode,
} from './coach-formations';
export type {
  CoachFormation,
  CoachFormationPosition,
  FormationPlacement,
} from './coach-formations';

export {
  POSITION_KEYS,
  isPositionKey,
  roleFromPositionKey,
  normalizePositionCode,
  DEFAULT_POSITION_KEY,
} from './positions';
export type { PositionKey } from './positions';

export {
  calledUpOnPlace,
  calledUpOnRemove,
  effectiveCallupDecision,
  groupRosterByCallup,
} from './callup-sync';
export type {
  CallupDecision,
  CalledUpOp,
  CallupGroups,
} from './callup-sync';
