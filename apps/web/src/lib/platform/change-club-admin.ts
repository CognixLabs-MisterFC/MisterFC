'use server';

import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
  inviteEmailMetadata,
  isEmailAlreadyExistsError,
  inviteLink,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';

/**
 * Cambiar el admin de un club (consola superadmin). Mismo patrón que
 * `inviteClubAdmin`, pero llama a la RPC `platform_change_club_admin`, que ATÓMICA:
 * corta al admin actual (le quita la membership admin_club de ESTE club), deja el
 * club sin owner e inserta la invitación admin para el nuevo email. Aquí, tras la
 * RPC, se ENVÍA el email (paso no transaccional, igual que en la invitación normal).
 *
 * Nota: el corte del viejo admin ya está commiteado por la RPC; si el email falla,
 * el club queda sin owner con la invitación pendiente → recuperable reinvitando
 * desde la misma pantalla (que pasa a estado "sin owner").
 *
 * Correo-B3 — la cuenta se crea con `createUser` (que no manda correo) y el correo lo
 * manda la app por Resend, en el idioma del destinatario. Aquí ese idioma se acierta
 * casi siempre: a quien se nombra admin de un club suele conocérsele ya, y si tiene
 * cuenta manda su `profiles.locale`.
 *
 * DUPLICACIÓN DELIBERADA con `invite-club-admin.ts`, y el `createUser(` a la vista en
 * los dos ficheros: es lo que cuenta el guard de censo. Ver la nota de allí.
 */

export type ChangeClubAdminError =
  | 'no_session'
  | 'forbidden'
  | 'club_not_found'
  | 'no_current_admin'
  | 'email_invalid'
  | 'generic';

export type ChangeClubAdminResult = { ok: { email: string } } | { error: ChangeClubAdminError };

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: number; code?: string };
    return { name: err.name, message: err.message, status: anyErr.status, code: anyErr.code };
  }
  try {
    return JSON.parse(JSON.stringify(err));
  } catch {
    return { repr: String(err) };
  }
}

function mapRpcError(message: string | undefined): ChangeClubAdminError {
  const m = message ?? '';
  if (m.includes('no_session')) return 'no_session';
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('club_not_found')) return 'club_not_found';
  if (m.includes('no_current_admin')) return 'no_current_admin';
  if (m.includes('email_invalid')) return 'email_invalid';
  return 'generic';
}

export async function changeClubAdmin(input: {
  clubId: string;
  email: string;
  locale: string;
}): Promise<ChangeClubAdminResult> {
  const { clubId, email, locale } = input;
  const maskedEmail = maskEmail(email);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'no_session' };

  const { data: isSuper } = await supabase.rpc('is_superadmin');
  if (isSuper !== true) return { error: 'forbidden' };

  // Paso 1: cambio atómico en BD (corta al viejo, owner NULL, crea invitación).
  const { data: rows, error: rpcErr } = await supabase.rpc('platform_change_club_admin', {
    p_club_id: clubId,
    p_new_email: email,
  });
  if (rpcErr) {
    console.error(
      '[platform][change-admin] rpc_failed ' +
        JSON.stringify({ masked_email: maskedEmail, club_id: clubId, error: serializeError(rpcErr) }),
    );
    return { error: mapRpcError(rpcErr.message) };
  }
  const invite = Array.isArray(rows) ? rows[0] : rows;
  if (!invite?.invitation_id || !invite?.token) {
    console.error('[platform][change-admin] rpc_returned_null', { club_id: clubId });
    return { error: 'generic' };
  }

  // Paso 2: enviar el email (patrón inviteClubAdmin).
  // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const redirectTo = inviteLink(locale, invite.token);

  const admin = createSupabaseAdminClient();

  // ¿Ya tiene cuenta este correo? Antes de crear nada: decide si hay cuenta que
  // crear, cuál enlazar y en qué idioma escribir.
  let found: Awaited<ReturnType<ReturnType<typeof inviteRecipientPort>>> = null;
  try {
    found = await inviteRecipientPort(admin)(email);
  } catch (thrown) {
    console.error(
      '[platform][change-admin] lookup_failed ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(thrown) }),
    );
  }
  const emailLocale = found?.locale ?? locale;

  try {
    if (found && !found.invitePending) {
      // Cuenta suya: no se toca ni se enlaza; acepta con su propia sesión.
      console.info('[platform][change-admin] cuenta_existente', {
        masked_email: maskedEmail,
        invitation_id: invite.invitation_id,
      });
    } else if (found && found.invitePending) {
      // Cuenta que creamos y nadie reclamó: se ENLAZA ésa. Aquí importa más que en
      // ningún otro sender: el club ya se ha quedado SIN owner (la RPC cortó al
      // admin viejo), así que una invitación sin enlazar deja el club sin nadie que
      // pueda entrar.
      const linkRes = await linkInvitedUser(admin, invite.invitation_id, found.userId, {
        feature: 'platform',
        step: 'change_admin_link',
        maskedEmail,
      });
      if (!linkRes.ok) return { error: 'generic' };
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        // Su correo ES su prueba. Sin esto GoTrue le niega el login al fijar la
        // contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.invitation_id,
          kind: 'admin',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          console.error(
            '[platform][change-admin] create_race ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(createErr) }),
          );
        } else {
          console.error(
            '[platform][change-admin] create_returned_error ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(createErr) }),
          );
          Sentry.captureException(createErr, { tags: { feature: 'platform', step: 'change_admin_create' } });
          return { error: 'generic' };
        }
      } else {
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // #535: creación OK pero sin user.id → antes MUDO. Ruidoso + error al admin.
          console.error(
            '[platform][change-admin] invited_user_missing_id ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id }),
          );
          Sentry.captureMessage('[platform] createUser sin user.id (change-admin)', {
            level: 'error',
            tags: { feature: 'platform', step: 'change_admin_missing_id' },
          });
          return { error: 'generic' };
        }
        // Enlaza y EXIGE 1 fila afectada: un UPDATE de cero filas no da error en
        // PostgREST y dejaría invited_user_id NULL en silencio (raíz del incidente).
        const linkRes = await linkInvitedUser(admin, invite.invitation_id, invitedUserId, {
          feature: 'platform',
          step: 'change_admin_link',
          maskedEmail,
        });
        if (!linkRes.ok) return { error: 'generic' };
      }
    }
  } catch (thrown) {
    console.error(
      '[platform][change-admin] create_thrown ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(thrown) }),
    );
    Sentry.captureException(thrown, { tags: { feature: 'platform', step: 'change_admin_create_thrown' } });
    return { error: 'generic' };
  }

  // El correo, LO ÚLTIMO. Si falla, el club se queda sin owner con la invitación
  // pendiente y enlazada: reinvitar desde la misma pantalla vuelve a mandarlo.
  const { error: mailErr } = await invitationEmailPort('admin')({
    to: email,
    url: redirectTo,
    locale: emailLocale,
  });
  if (mailErr) {
    console.error(
      '[platform][change-admin] email_failed ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(mailErr) }),
    );
    Sentry.captureException(mailErr, { tags: { feature: 'platform', step: 'change_admin_send_email' } });
    return { error: 'generic' };
  }

  console.info('[platform][change-admin] done', { masked_email: maskedEmail, invitation_id: invite.invitation_id });
  return { ok: { email } };
}
