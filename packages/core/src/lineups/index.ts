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
