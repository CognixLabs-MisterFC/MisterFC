import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DeliveryRecordLogger, InviteKind } from '@misterfc/core';
import { sendEmail, type SendEmailResult } from './resend';
import { invitationEmail } from './invitation-email';
import { lookupInviteRecipient, normalizeLocale } from './invite-recipient';

/**
 * Correo-B — Los dos puertos de web que necesita un sender migrado a Resend: buscar
 * al destinatario y mandarle el correo. Los rellena cada wrapper
 * (`lib/invite-spectator.ts`, `lib/invite-self.ts`, …) y así no se copian.
 *
 * QUÉ SE PUEDE COMPARTIR Y QUÉ NO. Esto NO contradice la nota de
 * `lib/link-invited-user.ts` que desaconseja unificar los senders: lo que allí no se
 * puede esconder es el ENVÍO dentro del sender —el literal que el guard de censo
 * cuenta por fichero—, porque un sender nuevo dejaría de aparecer en ningún censo.
 * Aquí se comparte el ADAPTADOR de web, que vive fuera de los senders y no entra en
 * ningún censo: cada sender sigue teniendo su `createUser(` y su
 * `inviteEmailMetadata(` a la vista, contados uno a uno.
 */

type DbClient = SupabaseClient<Database>;

/**
 * Puerto de correo: compone en el idioma que el sender ya resolvió y manda por
 * Resend. Devuelve `{ error }` sin lanzar — qué hacer con un correo que no sale lo
 * decide el sender, que es quien sabe qué hay creado ya.
 */
export function invitationEmailPort(kind: InviteKind) {
  // El tipo de retorno se declara a mano: sin él, la rama del `catch` estrecha la
  // inferencia a `{ error }` y el `id` del envío —lo que A-2 necesita— desaparece.
  return async (args: {
    to: string;
    url: string;
    locale: string;
    role?: string;
  }): Promise<SendEmailResult> => {
    try {
      const locale = normalizeLocale(args.locale, 'es');
      const message = await invitationEmail({ kind, locale, url: args.url, role: args.role });
      return await sendEmail({ to: args.to, message });
    } catch (thrown) {
      // Componer también puede fallar (un `kind` sin textos, un catálogo incompleto).
      // Es un error de correo como cualquier otro: lo registra el sender, y no
      // revienta la acción de quien invita.
      return { error: thrown };
    }
  };
}

/**
 * A-2 — el logger que `recordInvitationDelivery` inyecta desde web. Mismo `console.error`
 * + Sentry que el resto de los senders, y con la etiqueta de su área: los dos senders de
 * plataforma (`invite-club-admin`, `change-club-admin`) van bajo `platform`, que es donde
 * se miran sus incidentes.
 */
export function deliveryLogger(feature: 'invitations' | 'platform'): DeliveryRecordLogger {
  return (error, step, extra) => {
    console.error(`[${feature}] ${step}`, { ...extra, error });
    Sentry.captureException(error, { tags: { feature, step }, extra });
  };
}

/** Puerto de búsqueda: ¿tiene cuenta ese correo, está sin reclamar, qué idioma habla? */
export function inviteRecipientPort(admin: DbClient) {
  return (email: string) => lookupInviteRecipient(admin, email);
}
