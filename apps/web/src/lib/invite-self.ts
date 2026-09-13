import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  performSelfInvite as corePerformSelfInvite,
  type Database,
  type SelfInviteResult,
} from '@misterfc/core';
import { linkInvitedUser } from '@/lib/link-invited-user';

export type { SelfInviteResult };

/**
 * MN-5 — Wrapper web de la orquestación "el tutor invita a su hijo" (core). Mismo
 * patrón que `lib/invite-spectator.ts`: único punto que inyecta las dos dependencias
 * de apps/web (core no depende de ninguna):
 *   · el logger de Sentry;
 *   · el ENLAZADO de `invitations.invited_user_id` (`linkInvitedUser`, el MISMO
 *     helper de los otros siete senders, con su guard de "exactamente 1 fila").
 * Lo usan tanto la Server Action web (cookie) como el route handler nativo (bearer).
 */
export function performSelfInvite(
  userSupabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  args: { playerId: string; email: string; linkBase: string },
): Promise<SelfInviteResult> {
  return corePerformSelfInvite(
    userSupabase,
    admin,
    args,
    (invitationId, invitedUserId) =>
      linkInvitedUser(admin, invitationId, invitedUserId, {
        feature: 'invitations',
        step: 'link_invited_user_self',
      }),
    (error, step, extra) =>
      Sentry.captureException(error, {
        tags: { feature: 'invitations', step },
        extra,
      }),
  );
}
