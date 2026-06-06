/**
 * Zod schemas compartidos.
 */

export {
  signinSchema,
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  acceptInvitationWithProfileSchema,
  createClubSchema,
  sendInvitationSchema,
} from './auth';
export type {
  SigninInput,
  SignupInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  AcceptInvitationWithProfileInput,
  CreateClubInput,
  SendInvitationInput,
} from './auth';

export {
  updateProfileSchema,
  avatarUploadSchema,
  AVATAR_MIME_TYPES,
  AVATAR_MAX_BYTES,
} from './profile';
export type { UpdateProfileInput, AvatarUploadInput } from './profile';

export {
  categorySchema,
  teamSchema,
  TEAM_FORMATS,
  currentSeason,
} from './club-structure';
export type { CategoryInput, TeamInput } from './club-structure';

export {
  createPlayerSchema,
  updatePlayerSchema,
  updateMedicalNotesSchema,
  playerPhotoUploadSchema,
  assignPlayerToTeamSchema,
  invitePlayerTutorSchema,
  PLAYER_POSITIONS,
  PLAYER_FEET,
  PLAYER_ACCOUNT_RELATIONS,
  PLAYER_PHOTO_MIME_TYPES,
  PLAYER_PHOTO_MAX_BYTES,
} from './player';
export type {
  CreatePlayerInput,
  UpdatePlayerInput,
  UpdateMedicalNotesInput,
  PlayerPhotoUploadInput,
  AssignPlayerToTeamInput,
  InvitePlayerTutorInput,
  PlayerPosition,
  PlayerFoot,
  PlayerAccountRelation,
} from './player';

export {
  sendStaffInvitationSchema,
  updateCapabilitySchema,
  TEAM_STAFF_ROLES,
  CAPABILITY_NAMES,
} from './staff';
export type {
  SendStaffInvitationInput,
  UpdateCapabilityInput,
  TeamStaffRole,
  CapabilityName,
} from './staff';

export {
  PLAYER_IMPORT_COLUMNS,
  playerImportRowSchema,
  playerImportPayloadSchema,
  normalizeDate,
  validateRow,
  detectDuplicates,
  dedupKey,
  summarize,
  mapHeaders,
  parseTabular,
} from '../import';

export {
  recurrenceRuleSchema,
  eventInputSchema,
  updateEventModes,
  deleteEventModes,
  EVENT_TARGET_KINDS,
} from './event';
export type {
  RecurrenceRuleInput,
  EventInput,
  UpdateEventMode,
  DeleteEventMode,
} from './event';

export {
  ATTENDANCE_CODES,
  ATTENDANCE_QUICK_CYCLE,
  ATTENDANCE_PRIMARY_CHIPS,
  ATTENDANCE_SECONDARY_CHIPS,
  ATTENDANCE_CODES_PRESENT,
  ATTENDANCE_CODES_JUSTIFIED,
  ATTENDANCE_CODES_UNJUSTIFIED,
  ATTENDANCE_CODES_PARTIAL,
  markAttendanceSchema,
  markAttendanceBulkSchema,
  nextQuickCycle,
  bucketOf,
  isPrimaryChip,
  otherChipLabel,
} from './attendance';
export type {
  AttendanceCode,
  MarkAttendanceInput,
  MarkAttendanceBulkInput,
  AttendanceBucket,
} from './attendance';
export type {
  PlayerImportColumn,
  PlayerImportRow,
  PlayerImportPayload,
  RowStatus,
  ValidatedRow,
  ExistingPlayer,
  ParsedTabular,
  ParseTabularError,
} from '../import';

export {
  startConversationSchema,
  sendMessageSchema,
  announcementInputSchema,
  announcementUpdateSchema,
  auditReasonSchema,
  MESSAGE_RATE_LIMIT,
} from './messaging';
export type {
  StartConversationInput,
  SendMessageInput,
  AnnouncementInput,
  AnnouncementUpdateInput,
} from './messaging';

export {
  TRANSPORT_MODES,
  CALLUP_RESPONSE_STATUSES,
  CALLUP_DECISION_KINDS,
  publishCallupSchema,
  upsertCallupResponseSchema,
  upsertCallupDecisionSchema,
} from './callup';
export type {
  TransportMode,
  CallupResponseStatus,
  CallupDecisionKind,
  PublishCallupInput,
  UpsertCallupResponseInput,
  UpsertCallupDecisionInput,
} from './callup';

export {
  createLineupSchema,
  setLineupFormationSchema,
  renameLineupSchema,
  setLineupOfficialSchema,
  setLineupVisibilitySchema,
  setTacticalNotesSchema,
  createPlannedSubSchema,
  deletePlannedSubSchema,
  deleteLineupPositionSchema,
  upsertLineupPositionSchema,
} from './lineup';
export type {
  CreateLineupInput,
  SetLineupFormationInput,
  RenameLineupInput,
  SetLineupOfficialInput,
  SetLineupVisibilityInput,
  SetTacticalNotesInput,
  CreatePlannedSubInput,
  DeletePlannedSubInput,
  DeleteLineupPositionInput,
  UpsertLineupPositionInput,
} from './lineup';

export {
  COACH_FORMATION_FORMATS,
  coachFormationPositionSchema,
  createCoachFormationSchema,
  updateCoachFormationSchema,
  deleteCoachFormationSchema,
} from './coach-formation';
export type {
  CreateCoachFormationInput,
  UpdateCoachFormationInput,
  DeleteCoachFormationInput,
} from './coach-formation';

export {
  matchEventRefSchema,
  startNextPeriodSchema,
  adjustClockSchema,
} from './match-clock';
export type {
  MatchEventRefInput,
  StartNextPeriodInput,
  AdjustClockInput,
} from './match-clock';

export {
  registerPlayerEventSchema,
  registerFieldEventSchema,
  registerSubstitutionSchema,
  setAbsenceSchema,
  registerRivalEventSchema,
  registerFoulSchema,
  registerCornerSchema,
  registerPenaltySchema,
  registerRivalPenaltySchema,
  registerShootoutKickSchema,
  movePlayerSchema,
  changeFormationSchema,
  deleteMatchEventSchema,
  updateEventMinuteSchema,
  updateEventActorSchema,
  addTimelineEventSchema,
  TIMELINE_ADD_TYPES,
} from './match-event';
export type {
  RegisterPlayerEventInput,
  RegisterFieldEventInput,
  RegisterSubstitutionInput,
  SetAbsenceInput,
  RegisterRivalEventInput,
  RegisterFoulInput,
  RegisterCornerInput,
  RegisterPenaltyInput,
  RegisterRivalPenaltyInput,
  RegisterShootoutKickInput,
  MovePlayerInput,
  ChangeFormationInput,
  DeleteMatchEventInput,
  UpdateEventMinuteInput,
  UpdateEventActorInput,
  AddTimelineEventInput,
} from './match-event';
