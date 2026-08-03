export * from './queries';

// O2-7b-1 — lado STAFF (armar + ver respuestas): scope, lectura y decisiones.
export { resolveConvocatoriasScopeFromClient } from './staff-scope';
export type { ConvocatoriasScope } from './staff-scope';
export {
  getStaffCallupsFromClient,
  getStaffCallupDetailFromClient,
} from './staff-queries';
export type {
  CallupMatchRow,
  CallupMetaRow,
  CallupResponseRow,
  CallupDecisionRow,
  CallupPlayerRow,
  CallupDetail,
} from './staff-queries';
export {
  upsertCallupDecisionFromClient,
  clearCallupDecisionFromClient,
  syncLineupsForDecision,
} from './staff-writes';
export type {
  CallupDecisionError,
  CallupDecisionOutcome,
  ClearCallupDecisionOutcome,
  SyncErrorLogger,
} from './staff-writes';
