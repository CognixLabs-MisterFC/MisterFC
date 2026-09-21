import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  performSpectatorInvite as corePerformSpectatorInvite,
  type Database,
  type SpectatorInviteResult,
} from '@misterfc/core';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';

export type { SpectatorInviteResult };

/**
 * O2-5 F2 — Wrapper web de la orquestación "invitar seguidor" (core). Único punto
 * que inyecta las dependencias de apps/web (core no depende de ninguna):
 *   · el logger de Sentry;
 *   · el ENLAZADO de `invitations.invited_user_id` (`linkInvitedUser`, el MISMO
 *     helper de los otros seis senders, con su guard de "exactamente 1 fila" y su
 *     Sentry). Así el guard sigue viviendo en un solo sitio.
 *   · Correo-B1 — el CORREO: componerlo con el catálogo de next-intl y mandarlo por
 *     Resend. Va aquí y no en core porque las traducciones y el transporte son de la
 *     web; core solo pide "manda esto, en este idioma".
 *   · Correo-B1 — la BÚSQUEDA del destinatario (`lookupInviteRecipient`): si ya tiene
 *     cuenta, si esa cuenta es una invitación sin reclamar y en qué idioma habla. Con
 *     eso el sender decide si crear, si enlazar y cómo escribirle.
 * Lo usan tanto la Server Action web (cookie) como el route handler nativo
 * (bearer): misma lógica, mismo logging, mismo enlazado, mismo correo.
 */
export function performSpectatorInvite(
  userSupabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  args: { playerId: string; email: string; linkBase: string; locale: string },
): Promise<SpectatorInviteResult> {
  return corePerformSpectatorInvite(
    userSupabase,
    admin,
    args,
    (invitationId, invitedUserId) =>
      linkInvitedUser(admin, invitationId, invitedUserId, {
        feature: 'invitations',
        step: 'link_invited_user_spectator',
      }),
    invitationEmailPort('seguidor'),
    inviteRecipientPort(admin),
    (error, step, extra) =>
      Sentry.captureException(error, {
        tags: { feature: 'invitations', step },
        extra,
      }),
  );
}
