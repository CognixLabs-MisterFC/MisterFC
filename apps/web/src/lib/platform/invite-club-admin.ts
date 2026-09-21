'use server';

import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
  inviteEmailMetadata,
  isEmailAlreadyExistsError,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';

/**
 * F14B-5b — Acción de consola (superadmin): invita al admin de un club SIN owner.
 *
 * NO está cableada a ninguna pantalla todavía (la UI es F14B-7). Reutiliza el
 * patrón de `sendInvitation` (invitations/actions.ts) pero para el superadmin:
 *   1. Gate is_superadmin() (server-side + la RPC lo reimpone).
 *   2. platform_invite_club_admin (RPC SECURITY DEFINER) crea la invitación
 *      admin_club saltando invitations_insert_admin.
 *   3. Correo-B3 — se busca al destinatario, se crea su cuenta con `createUser` si
 *      no la tiene, se enlaza `invited_user_id` y se le manda el correo por Resend,
 *      EN SU IDIOMA. Antes lo mandaba GoTrue dentro de `inviteUserByEmail`, con la
 *      plantilla única del dashboard, que no puede leer `profiles.locale` y salía
 *      siempre en castellano.
 *
 * El guard F14D (handle_new_user) admite el alta porque la cuenta se crea con
 * invitation_id en user_metadata.
 *
 * DUPLICACIÓN DELIBERADA con `change-club-admin.ts`: los dos hacen lo mismo con
 * distinto registro. El `createUser(` y el `inviteEmailMetadata(` se quedan a la
 * vista EN CADA FICHERO porque el guard de censo los cuenta ahí
 * (scripts/check-invite-senders.mjs); esconderlos tras un helper común dejaría
 * ciegos a los dos censos de golpe. Lo que sí se comparte son los puertos de web
 * (lib/email/invite-ports.ts), que no entran en ningún censo.
 */

export type InviteClubAdminError =
  | 'no_session'
  | 'forbidden'
  | 'club_not_found'
  | 'club_already_has_admin'
  | 'invalid_email'
  | 'generic';

export type InviteClubAdminResult = { ok: { email: string } } | { error: InviteClubAdminError };

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: number; code?: string; details?: unknown; hint?: unknown };
    return { name: err.name, message: err.message, status: anyErr.status, code: anyErr.code };
  }
  try {
    return JSON.parse(JSON.stringify(err));
  } catch {
    return { repr: String(err) };
  }
}

function mapRpcError(message: string | undefined): InviteClubAdminError {
  const m = message ?? '';
  if (m.includes('no_session')) return 'no_session';
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('club_not_found')) return 'club_not_found';
  if (m.includes('club_already_has_admin')) return 'club_already_has_admin';
  if (m.includes('invalid_email')) return 'invalid_email';
  return 'generic';
}

export async function inviteClubAdmin(input: {
  clubId: string;
  email: string;
  locale: string;
}): Promise<InviteClubAdminResult> {
  const { clubId, email, locale } = input;
  const maskedEmail = maskEmail(email);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'no_session' };

  // Gate server-side (la RPC lo reimpone de todos modos).
  const { data: isSuper } = await supabase.rpc('is_superadmin');
  if (isSuper !== true) return { error: 'forbidden' };

  // Paso 1: crear la invitación admin_club vía RPC (salta la policy).
  const { data: rows, error: rpcErr } = await supabase.rpc('platform_invite_club_admin', {
    p_club_id: clubId,
    p_email: email,
  });
  if (rpcErr) {
    console.error(
      '[platform][invite-admin] rpc_failed ' +
        JSON.stringify({ masked_email: maskedEmail, club_id: clubId, error: serializeError(rpcErr) }),
    );
    return { error: mapRpcError(rpcErr.message) };
  }
  const invite = Array.isArray(rows) ? rows[0] : rows;
  if (!invite?.id || !invite?.token) {
    console.error('[platform][invite-admin] rpc_returned_null', { club_id: clubId });
    return { error: 'generic' };
  }

  // Paso 2: enviar el email (patrón sendInvitation).
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const redirectTo = `${proto}://${host}/${locale}/invite/${invite.token}`;

  const admin = createSupabaseAdminClient();

  // ¿Ya tiene cuenta este correo? Se mira ANTES de crear nada: decide si hay que
  // crear cuenta, cuál enlazar y en qué idioma escribirle (Correo-B1, mismo criterio
  // que los senders de core). Si la búsqueda falla, se sigue como si no la tuviera.
  let found: Awaited<ReturnType<ReturnType<typeof inviteRecipientPort>>> = null;
  try {
    found = await inviteRecipientPort(admin)(email);
  } catch (thrown) {
    console.error(
      '[platform][invite-admin] lookup_failed ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(thrown) }),
    );
  }
  const emailLocale = found?.locale ?? locale;

  try {
    if (found && !found.invitePending) {
      // Cuenta suya: no se toca ni se enlaza. invited_user_id queda NULL → al
      // aceptar, inicia sesión con su contraseña (flujo "existing").
      console.info('[platform][invite-admin] cuenta_existente', {
        masked_email: maskedEmail,
        invitation_id: invite.id,
      });
    } else if (found && found.invitePending) {
      // Cuenta que creamos y nadie reclamó: se ENLAZA ésa, no se crea otra. Sin
      // esto, reinvitar al mismo admin deja la invitación nueva sin enlazar y le
      // pide una contraseña que nunca fijó (incidente de agosto de 2026).
      const linkRes = await linkInvitedUser(admin, invite.id, found.userId, {
        feature: 'platform',
        step: 'link_invited_user',
        maskedEmail,
      });
      if (!linkRes.ok) return { error: 'generic' };
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        // Su correo ES su prueba: el enlace le llega ahí. Sin esto GoTrue le niega
        // el login al fijar la contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'admin',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // La búsqueda dijo que no había cuenta y sí la hay: se trata como ajena
          // (lo conservador) y queda rastro.
          console.error(
            '[platform][invite-admin] create_race ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(createErr) }),
          );
        } else {
          console.error(
            '[platform][invite-admin] create_returned_error ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(createErr) }),
          );
          Sentry.captureException(createErr, { tags: { feature: 'platform', step: 'createUser' } });
          return { error: 'generic' };
        }
      } else {
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // #535: creación OK pero sin user.id → antes MUDO. Sin invited_user_id la
          // invitación lleva a la trampa: ruidoso + error al admin para reintentar.
          console.error(
            '[platform][invite-admin] invited_user_missing_id ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id }),
          );
          Sentry.captureMessage('[platform] createUser sin user.id (invite-admin)', {
            level: 'error',
            tags: { feature: 'platform', step: 'invited_user_missing_id' },
          });
          return { error: 'generic' };
        }
        // Enlaza y EXIGE 1 fila afectada: un UPDATE de cero filas no da error en
        // PostgREST y dejaría invited_user_id NULL en silencio (raíz del incidente).
        const linkRes = await linkInvitedUser(admin, invite.id, invitedUserId, {
          feature: 'platform',
          step: 'link_invited_user',
          maskedEmail,
        });
        if (!linkRes.ok) return { error: 'generic' };
      }
    }
  } catch (thrown) {
    console.error(
      '[platform][invite-admin] create_thrown ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(thrown) }),
    );
    Sentry.captureException(thrown, { tags: { feature: 'platform', step: 'createUser_thrown' } });
    return { error: 'generic' };
  }

  // El correo, LO ÚLTIMO: con la invitación creada y la cuenta ya enlazada. Si falla
  // aquí no queda nada roto y reinvitar desde la consola vuelve a intentarlo.
  const { error: mailErr } = await invitationEmailPort('admin')({
    to: email,
    url: redirectTo,
    locale: emailLocale,
  });
  if (mailErr) {
    console.error(
      '[platform][invite-admin] email_failed ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(mailErr) }),
    );
    Sentry.captureException(mailErr, { tags: { feature: 'platform', step: 'send_invite_email' } });
    return { error: 'generic' };
  }

  console.info('[platform][invite-admin] sent', { masked_email: maskedEmail, invitation_id: invite.id });
  return { ok: { email } };
}
