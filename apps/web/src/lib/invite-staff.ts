import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  performStaffInvite as corePerformStaffInvite,
  type Database,
  type InvitableRole,
  type StaffInviteResult,
} from '@misterfc/core';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';
import { maskEmail } from '@/lib/mask-email';

export type { StaffInviteResult };

/**
 * W-6 — envoltorio web de «invitar al club» (core). Único punto que inyecta las
 * dependencias de `apps/web`; core no depende de ninguna:
 *
 *   · el ENLAZADO de `invitations.invited_user_id` (`linkInvitedUser`, el MISMO helper
 *     de los siete senders, con su guard de «exactamente 1 fila»);
 *   · el CORREO: componerlo con el catálogo de next-intl y mandarlo por Resend
 *     (`invitationEmailPort('staff')`, que además dice el ROL con el que se invita);
 *   · la BÚSQUEDA del destinatario (`inviteRecipientPort`): si ya tiene cuenta, si esa
 *     cuenta es una invitación sin reclamar y en qué idioma habla;
 *   · los dos puertos de LOG, con el correo enmascarado. A core solo le llegan pasos e
 *     identificadores, nunca la dirección.
 *
 * Lo usan la Server Action web (cookie) y el route handler nativo (bearer): misma
 * lógica, mismo enlazado, mismo correo. Es la forma que ya usaba el seguidor desde
 * O2-5, y la que impide que la app tenga una segunda implementación de nada — la
 * regla `covered` incluida, que sigue siendo `pendingCoversEmail` y solo esa.
 */
export function performStaffInvite(
  userSupabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  args: {
    actorProfileId: string;
    /** El club en el que se invita: lo decide el llamante. Ver core. */
    clubId: string;
    email: string;
    role: InvitableRole;
    teamId: string | null;
    locale: string;
    linkBase: string;
  },
): Promise<StaffInviteResult> {
  const masked = maskEmail(args.email);
  return corePerformStaffInvite(
    userSupabase,
    admin,
    args,
    (invitationId, invitedUserId) =>
      linkInvitedUser(admin, invitationId, invitedUserId, {
        feature: 'invitations',
        step: 'link_invited_user',
        maskedEmail: masked,
      }),
    invitationEmailPort('staff'),
    inviteRecipientPort(admin),
    (error, step, extra) => {
      console.error(
        `[invitations] ${step} ` +
          JSON.stringify({ step, masked_email: masked, ...extra }),
      );
      Sentry.captureException(error, {
        tags: { feature: 'invitations', step },
        extra: { masked_email: masked, ...extra },
      });
    },
    (event, extra) => {
      console.info(`[invitations] ${event}`, { masked_email: masked, ...extra });
    },
  );
}
