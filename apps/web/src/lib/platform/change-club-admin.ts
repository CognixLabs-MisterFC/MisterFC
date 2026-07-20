'use server';

import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

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
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const redirectTo = `${proto}://${host}/${locale}/invite/${invite.token}`;

  const admin = createSupabaseAdminClient();
  try {
    const { data: inviteData, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invite_pending: true, invitation_id: invite.invitation_id },
    });

    if (invErr) {
      const code = 'code' in invErr ? invErr.code : undefined;
      const alreadyExists =
        code === 'email_exists' ||
        invErr.message?.toLowerCase().includes('already been registered') ||
        invErr.message?.toLowerCase().includes('already exists');

      if (alreadyExists) {
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetErr) {
          console.error(
            '[platform][change-admin] reset_fallback_failed ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(resetErr) }),
          );
          Sentry.captureException(resetErr, { tags: { feature: 'platform', step: 'change_admin_reset_fallback' } });
          return { error: 'generic' };
        }
      } else {
        console.error(
          '[platform][change-admin] invite_returned_error ' +
            JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(invErr) }),
        );
        Sentry.captureException(invErr, { tags: { feature: 'platform', step: 'change_admin_invite' } });
        return { error: 'generic' };
      }
    } else {
      const invitedUserId = inviteData?.user?.id ?? null;
      if (invitedUserId) {
        const { error: linkErr } = await admin
          .from('invitations')
          .update({ invited_user_id: invitedUserId })
          .eq('id', invite.invitation_id);
        if (linkErr) {
          console.error(
            '[platform][change-admin] link_invited_user_failed ' +
              JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(linkErr) }),
          );
          Sentry.captureException(linkErr, { tags: { feature: 'platform', step: 'change_admin_link' } });
        }
      }
    }
  } catch (thrown) {
    console.error(
      '[platform][change-admin] invite_thrown ' +
        JSON.stringify({ masked_email: maskedEmail, invitation_id: invite.invitation_id, error: serializeError(thrown) }),
    );
    Sentry.captureException(thrown, { tags: { feature: 'platform', step: 'change_admin_invite_thrown' } });
    return { error: 'generic' };
  }

  console.info('[platform][change-admin] done', { masked_email: maskedEmail, invitation_id: invite.invitation_id });
  return { ok: { email } };
}
