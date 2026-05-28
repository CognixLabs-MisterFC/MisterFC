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
