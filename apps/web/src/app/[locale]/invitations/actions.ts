'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  sendInvitationSchema,
  createSupabaseServerClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type SendInvitationFormState = {
  error?: 'invalid_input' | 'forbidden' | 'no_club' | 'generic';
  ok?: { email: string };
};

const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'coordinador'];

/**
 * Devuelve un identificador del email seguro para logs (no PII completo).
 * Ej: "alice@example.com" → "al***@e***.com"
 * Útil para Sentry/Vercel logs sin filtrar el email entero.
 */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

/**
 * Server Action: crea una invitación y dispara el magic link.
 *
 * Reglas:
 *  - El user actual debe tener role admin_club o coordinador en el club activo.
 *  - En Fase 1 asumimos que el user solo administra **un** club (el primero
 *    de sus memberships). En Fase 2, cuando exista UI multi-club, esto se
 *    pasará explícito por param.
 *  - El magic link redirige tras autenticación a /[locale]/invite/{token}.
 *
 * Diagnostic logging (Bug 2): cada error path captura el error completo a
 * Sentry y a console.error (Vercel logs). Sin esto los fallos del API REST
 * de Supabase Auth quedan invisibles porque el try/catch del runtime de
 * Next no muestra el error al user.
 */
export async function sendInvitation(
  locale: string,
  _prev: SendInvitationFormState,
  formData: FormData
): Promise<SendInvitationFormState> {
  const teamIdRaw = formData.get('team_id');
  const parsed = sendInvitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    team_id: teamIdRaw && String(teamIdRaw).length > 0 ? teamIdRaw : null,
  });
  if (!parsed.success) {
    console.error('[invitations] invalid_input', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      })),
    });
    return { error: 'invalid_input' };
  }

  const maskedEmail = maskEmail(parsed.data.email);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  // Paso 1: leer memberships del user actual
  const { data: memberships, error: mErr } = await supabase
    .from('memberships')
    .select('id, club_id, role')
    .eq('profile_id', user.id);

  if (mErr) {
    console.error('[invitations] read_memberships_failed', {
      step: 'read_memberships',
      code: mErr.code,
      message: mErr.message,
      details: mErr.details,
      hint: mErr.hint,
    });
    Sentry.captureException(mErr, {
      tags: { feature: 'invitations', step: 'read_memberships' },
      extra: { user_id: user.id },
    });
    return { error: 'no_club' };
  }
  if (!memberships || memberships.length === 0) {
    console.warn('[invitations] no_memberships_found', { user_id: user.id });
    return { error: 'no_club' };
  }

  const authorized = memberships.find((m) =>
    ROLES_ALLOWED_TO_INVITE.includes(m.role as Role)
  );
  if (!authorized) {
    console.warn('[invitations] forbidden_role', {
      user_id: user.id,
      roles: memberships.map((m) => m.role),
    });
    return { error: 'forbidden' };
  }

  // Paso 2: INSERT en invitations
  const insertPayload = {
    email: parsed.data.email,
    role: parsed.data.role,
    club_id: authorized.club_id,
    team_id: parsed.data.team_id ?? null,
    created_by: user.id,
  };

  const { data: invite, error: insErr } = await supabase
    .from('invitations')
    .insert(insertPayload)
    .select('id, token')
    .single();

  if (insErr) {
    console.error('[invitations] insert_failed', {
      step: 'insert_invitation',
      code: insErr.code,
      message: insErr.message,
      details: insErr.details,
      hint: insErr.hint,
      payload: { ...insertPayload, email: maskedEmail },
    });
    Sentry.captureException(insErr, {
      tags: {
        feature: 'invitations',
        step: 'insert_invitation',
        pg_code: insErr.code ?? 'unknown',
      },
      extra: {
        club_id: authorized.club_id,
        role: parsed.data.role,
        team_id: parsed.data.team_id ?? null,
        masked_email: maskedEmail,
      },
    });
    return { error: 'generic' };
  }
  if (!invite) {
    console.error('[invitations] insert_returned_null');
    Sentry.captureMessage('[invitations] insert returned null without error', {
      level: 'error',
      tags: { feature: 'invitations', step: 'insert_invitation' },
    });
    return { error: 'generic' };
  }

  console.info('[invitations] inserted', {
    invitation_id: invite.id,
    role: parsed.data.role,
    masked_email: maskedEmail,
  });

  // Paso 3: si el rol es entrenador_ayudante, las capabilities se sembrarán al
  // crearse la membership en /invite/{token}/accept (trigger ensure_assistant_capabilities).
  // En 1.6 NO se crea membership aquí — solo la invitación.
  if (parsed.data.role === 'entrenador_ayudante') {
    console.info('[invitations] assistant_role_invited_capabilities_will_seed_on_accept', {
      invitation_id: invite.id,
    });
  }

  // Paso 4: magic link
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const next = `/${locale}/invite/${invite.token}`;
  const emailRedirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(
    next
  )}`;

  console.info('[invitations] sending_magic_link', {
    masked_email: maskedEmail,
    emailRedirectTo_origin: `${proto}://${host}`,
  });

  let otpResp: Awaited<ReturnType<typeof supabase.auth.signInWithOtp>>;
  try {
    otpResp = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });
  } catch (thrown) {
    // El SDK normalmente NO tira, devuelve { error }. Pero por si acaso.
    console.error('[invitations] otp_thrown', {
      step: 'signInWithOtp',
      thrown: thrown instanceof Error ? { name: thrown.name, message: thrown.message, stack: thrown.stack } : String(thrown),
      masked_email: maskedEmail,
    });
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'signInWithOtp_thrown' },
      extra: { masked_email: maskedEmail, invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  if (otpResp.error) {
    console.error('[invitations] otp_returned_error', {
      step: 'signInWithOtp',
      name: otpResp.error.name,
      message: otpResp.error.message,
      status: otpResp.error.status,
      code: 'code' in otpResp.error ? otpResp.error.code : undefined,
      masked_email: maskedEmail,
      invitation_id: invite.id,
    });
    Sentry.captureException(otpResp.error, {
      tags: {
        feature: 'invitations',
        step: 'signInWithOtp',
        otp_status: String(otpResp.error.status ?? 'unknown'),
      },
      extra: {
        masked_email: maskedEmail,
        invitation_id: invite.id,
      },
    });
    return { error: 'generic' };
  }

  console.info('[invitations] magic_link_sent', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
  });

  revalidatePath(`/${locale}/invitations`);
  return { ok: { email: parsed.data.email } };
}
