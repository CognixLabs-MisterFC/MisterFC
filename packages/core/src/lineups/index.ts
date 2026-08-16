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

// O2-8a — lectura READ-ONLY de la alineación de un partido (pintar, app nativa).
export {
  getLineupForEventFromClient,
  getSharedLineupForEventFromClient,
} from './queries';
export type {
  LineupView,
  LineupRosterPlayer,
  LineupVisibility,
  SharedLineupView,
  SharedLineupPlayer,
} from './queries';

// O2-8b — ESCRITURA de la alineación (drag: colocar/mover + cambiar formación).
// O2 alineación compartida — marcar oficial + compartir con el equipo (dos toggles,
// como la web); la web pasa a DELEGAR en estas (comportamiento idéntico).
export {
  upsertLineupPositionFromClient,
  setLineupFormationFromClient,
  setLineupOfficialFromClient,
  setLineupVisibilityFromClient,
  mapLineupPgErr,
} from './writes';
export type { LineupWriteError, LineupWriteOutcome } from './writes';

export {
  calledUpOnPlace,
  calledUpOnRemove,
  effectiveCallupDecision,
  groupRosterByCallup,
  callupRatioForPlayer,
} from './callup-sync';
export type {
  CallupDecision,
  CalledUpOp,
  CallupGroups,
  RosterMembership,
} from './callup-sync';
