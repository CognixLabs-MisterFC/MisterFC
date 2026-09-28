export {
  INVITE_KINDS,
  inviteEmailMetadata,
  type InviteKind,
  type InviteEmailMetadata,
} from './invite-email-metadata';
export {
  summarizePendingInvites,
  pendingCoversEmail,
  type PendingInviteCandidate,
  type PendingInviteEmailGroup,
  type PendingInviteSummary,
  type PendingInvitationRow,
} from './pending';
export {
  findAcceptProblems,
  playerIdsFromFormKeys,
  validateChildRow,
  isValidChildDob,
  isValidBirthDate,
  CHILD_FIRST_NAME_MAX,
  CHILD_LAST_NAME_MAX,
  type AcceptProblem,
  type AcceptProblemCode,
  type AcceptChild,
  type AcceptFormRules,
  type ChildRowError,
} from './accept-form';
export {
  playerInviteKind,
  type PlayerInviteKind,
  type PlayerInviteRow,
} from './player-invite-kind';
export {
  isSelfInvitation,
  hasSelfInvitation,
  needsTutorConsent,
  childrenNeedingConsent,
  tutorLinkPlayerIds,
  type RelationCarrier,
} from './self';
export {
  getSelfAccountStatusFromClient,
  isSelfAccountBlocker,
  selfAccountStatusMessageKey,
  SELF_ACCOUNT_BLOCKERS,
  type SelfAccountBlocker,
  type SelfAccountStatus,
} from './self-status';
export {
  acceptPendingInvitationsFromClient,
  claimInviteeAccount,
  mapAcceptRpcError,
  type AcceptPendingOutcome,
  type ClaimInviteeAccountOutcome,
  type InviteAcceptError,
  type InviteAcceptLogger,
} from './accept-new-invitee';
export {
  decideSelfAccept,
  type SelfAcceptDecision,
  type SelfAcceptInvitation,
  type SelfAcceptRefusal,
} from './self-accept';
export {
  performSelfInvite,
  type SelfInviteError,
  type SelfInviteLogger,
  type SelfInviteResult,
} from './self-invite';
export {
  canOfferSelfRevoke,
  getSelfRevokeGateFromClient,
  mapSelfRevokeError,
  revokePlayerSelfAccountFromClient,
  selfRevokeDoneMessageKey,
  type SelfRevokeError,
  type SelfRevokeGate,
  type SelfRevokeOutcome,
  type SelfRevokeResult,
} from './self-revoke';
export {
  recordInvitationDelivery,
  type DeliveryRecordLogger,
} from './delivery';
export {
  ingestResendDeliveryEvent,
  parseResendDeliveryEvent,
  shouldRetryDelivery,
  verifyResendSignature,
  RESEND_NON_DELIVERY_EVENTS,
  RESEND_SIGNATURE_HEADERS,
  RESEND_SIGNATURE_TOLERANCE_SECONDS,
  type DeliveryIngestResult,
  type ResendDeliveryEvent,
  type ResendSignatureHeaders,
} from './delivery-webhook';

/**
 * W-6 — invitar a alguien que NO está en el club. La única pieza de la serie que sí
 * necesita endpoint: crear y enlazar la cuenta del invitado exige la service-role, que
 * no puede vivir en un teléfono. El gate sigue siendo la RLS, porque la FILA se
 * escribe con el cliente del usuario y el admin entra después. Ver `staff-invite.ts`.
 */
export {
  canInviteToClub,
  invitableRoles,
  isHighClubRole,
  matchPendingByEmail,
  pendingInvitationsForEmailFromClient,
  performStaffInvite,
} from './staff-invite';
export type {
  InvitableRole,
  PendingClubInvitation,
  SendStaffInvitationEmail,
  StaffInviteError,
  StaffInviteErrorLogger,
  StaffInviteExistingMember,
  StaffInviteInfoLogger,
  StaffInviteResult,
} from './staff-invite';
