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
  playerEventClockFields,
} from './event';
export type { PlayerEventType, PlayerEventClockFields } from './event';
