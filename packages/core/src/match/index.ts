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
  REGULAR_PERIODS,
  EXTRA_PERIODS,
  isRegularPeriod,
  isExtraPeriod,
  nextRegularPeriod,
  nextExtraPeriod,
  canFinishMatch,
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

// Nota: `clampPct` ya se exporta desde lineups (coach-formations); aquí solo lo
// usamos internamente en tactics, no lo re-exportamos para evitar el choque.
export { moveLivePlayer, assignPlayersToFormation } from './tactics';
export type { LivePosition, LivePositions, FieldPlayerPos } from './tactics';

export {
  ROLLING_REGIME,
  DEFAULT_REGIME,
  limitedRegime,
  canRegisterSubstitution,
  subsRemaining,
} from './regime';
export type { RegimeType, SubstitutionRegime } from './regime';

export {
  computePlayingSeconds,
  countPlayerEvents,
  computePlayerMatchStats,
  flagLowPlaytime,
  leastPlayedIds,
} from './playing-time';
export type {
  MatchEventLite,
  PlayingTimeInput,
  PlayerEventCounts,
  PlayerMatchStats,
} from './playing-time';

export {
  PENALTY_OUTCOMES,
  isPenaltyOutcome,
  SHOOTOUT_OUTCOMES,
  isShootoutOutcome,
  isMatchGoal,
  computeScore,
  computeShootout,
} from './score';
export type {
  Side,
  PenaltyOutcome,
  ShootoutOutcome,
  ScoreEvent,
  MatchScore,
  ShootoutTally,
} from './score';

export {
  FOUL_KINDS,
  isFoulKind,
  CORNER_SIDES,
  isCornerSide,
  computeTeamEventTallies,
  foulsByPlayer,
} from './team-events';
export type {
  FoulKind,
  CornerSide,
  TeamEventLite,
  TeamEventTallies,
} from './team-events';
