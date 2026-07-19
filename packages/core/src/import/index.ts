export {
  PLAYER_IMPORT_COLUMNS,
  playerImportRowSchema,
  playerImportPayloadSchema,
  MAX_IMPORT_ROWS,
  normalizeDate,
  POSITION_VALUE_MAP,
  POSITION_LABELS_ES,
  FOOT_VALUE_MAP,
  FOOT_LABELS_ES,
} from './schema';
export type {
  PlayerImportColumn,
  PlayerImportRow,
  PlayerImportPayload,
} from './schema';

export {
  validateRow,
  detectDuplicates,
  dedupKey,
  summarize,
  buildTeamNameIndex,
  resolveTeamName,
  applyTeamResolution,
} from './validate';
export type {
  RowStatus,
  ValidatedRow,
  ExistingPlayer,
  ImportTeamRef,
  TeamResolution,
} from './validate';

export { mapHeaders, parseTabular } from './parse';
export type { ParseTabularError, ParsedTabular } from './parse';
