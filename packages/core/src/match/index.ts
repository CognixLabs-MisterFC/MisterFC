/**
 * F7 — API pública del módulo de partido en vivo (motor de reloj, §6).
 */

export {
  PERIOD_ORDER,
  periodClockSeconds,
  clockSecondsAt,
  currentPeriod,
  isClockRunning,
  isAtBreak,
  nextPeriodAfter,
  buildNextPeriod,
  pauseClockPatch,
  resumeClockPatch,
  endPeriodPatch,
  adjustClockPatch,
  formatClock,
  displayMinute,
} from './clock';
export type {
  PeriodKind,
  ClockPeriod,
  ClockMutation,
  NewPeriod,
} from './clock';

export {
  PLAYER_EVENT_TYPES,
  isPlayerEventType,
  FIELD_EVENT_TYPES,
  isFieldEventType,
  RIVAL_EVENT_TYPES,
  isRivalEventType,
  playerEventClockFields,
  resolveCardOutcome,
  isExpelled,
  mergeLiveEvents,
  deriveExpelledPlayers,
} from './event';
export type {
  PlayerEventType,
  FieldEventType,
  RivalEventType,
  PlayerEventClockFields,
  CardOutcome,
} from './event';

export { deriveSquad } from './squad';
export type {
  FieldSlot,
  Sub,
  BenchStatus,
  BenchEntry,
  Squad,
  DeriveSquadParams,
} from './squad';
