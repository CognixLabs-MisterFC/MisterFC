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
