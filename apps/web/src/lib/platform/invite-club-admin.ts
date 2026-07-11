'use server';

import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/**
 * F14B-5b — Acción de consola (superadmin): invita al admin de un club SIN owner.
 *
 * NO está cableada a ninguna pantalla todavía (la UI es F14B-7). Reutiliza el
 * patrón de `sendInvitation` (invitations/actions.ts) pero para el superadmin:
 *   1. Gate is_superadmin() (server-side + la RPC lo reimpone).
 *   2. platform_invite_club_admin (RPC SECURITY DEFINER) crea la invitación
 *      admin_club saltando invitations_insert_admin.
 *   3. inviteUserByEmail(email, { data: { invite_pending, invitation_id } }) —
 *      envía el email y crea la cuenta (o cae al fallback resetPasswordForEmail
 *      si el email ya existía), y enlaza invited_user_id.
 *
 * El guard F14D (handle_new_user) admite el alta porque el user creado por
 * inviteUserByEmail lleva invitation_id en user_metadata.
 */

export type InviteClubAdminResult =
  | { ok: { email: string } }
  | {
      error:
        | 'no_session'
        | 'forbidden'
        | 'club_not_found'
        | 'club_already_has_admin'
        | 'invalid_email'
        | 'generic';
    };

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

function mapRpcError(message: string | undefined): InviteClubAdminResult['error'] {
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
  try {
    const { data: inviteData, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invite_pending: true, invitation_id: invite.id },
    });

    if (invErr) {
      const code = 'code' in invErr ? invErr.code : undefined;
      const alreadyExists =
        code === 'email_exists' ||
        invErr.message?.toLowerCase().includes('already been registered') ||
        invErr.message?.toLowerCase().includes('already exists');

      if (alreadyExists) {
        // El admin ya tenía cuenta: reenviamos por resetPasswordForEmail reusando
        // la misma URL de invitación. invited_user_id queda NULL → al aceptar,
        // inicia sesión con su contraseña (flujo "existing").
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetErr) {
          console.error(
            '[platform][invite-admin] reset_fallback_failed ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(resetErr) }),
          );
          Sentry.captureException(resetErr, { tags: { feature: 'platform', step: 'reset_fallback' } });
          return { error: 'generic' };
        }
      } else {
        console.error(
          '[platform][invite-admin] invite_returned_error ' +
            JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(invErr) }),
        );
        Sentry.captureException(invErr, { tags: { feature: 'platform', step: 'inviteUserByEmail' } });
        return { error: 'generic' };
      }
    } else {
      // Cuenta creada por nosotros: enlazamos invited_user_id (como sendInvitation).
      const invitedUserId = inviteData?.user?.id ?? null;
      if (invitedUserId) {
        const { error: linkErr } = await admin
          .from('invitations')
          .update({ invited_user_id: invitedUserId })
          .eq('id', invite.id);
        if (linkErr) {
          console.error(
            '[platform][invite-admin] link_invited_user_failed ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(linkErr) }),
          );
          Sentry.captureException(linkErr, { tags: { feature: 'platform', step: 'link_invited_user' } });
        }
      }
    }
  } catch (thrown) {
    console.error(
      '[platform][invite-admin] invite_thrown ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.id, error: serializeError(thrown) }),
    );
    Sentry.captureException(thrown, { tags: { feature: 'platform', step: 'inviteUserByEmail_thrown' } });
    return { error: 'generic' };
  }

  console.info('[platform][invite-admin] sent', { masked_email: maskedEmail, invitation_id: invite.id });
  return { ok: { email } };
}
