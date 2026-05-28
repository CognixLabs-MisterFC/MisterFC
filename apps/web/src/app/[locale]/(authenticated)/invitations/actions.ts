'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  sendInvitationSchema,
  createSupabaseServerClient,
  createSupabaseAdminClient,
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
 */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

/**
 * Server Action: crea una invitación y dispara el email vía Supabase Invite.
 *
 * Flow (ADR-0004 — auth por email+password):
 *  1. Validar permisos del actor (admin_club o coordinador del club).
 *  2. INSERT en `invitations` con token + expiración.
 *  3. `auth.admin.inviteUserByEmail` — crea el user (si no existe) con
 *     email confirmado y dispara el template "Invite user" de Supabase
 *     con `redirectTo=/auth/callback?next=/invite/{token}`.
 *  4. Marca `app_metadata.invite_pending=true` para que la page de invitación
 *     muestre el form de password.
 *
 * No usamos `signInWithOtp` aquí (era el método pre-ADR-0004). Sustituido por
 * inviteUserByEmail porque encaja mejor con email+password: el user llega ya
 * autenticado al callback y solo tiene que establecer password una vez.
 */
export async function sendInvitation(
  locale: string,
  _prev: SendInvitationFormState,
  formData: FormData,
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

  // Paso 1: memberships del actor.
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

  const authorized = memberships.find((m) => ROLES_ALLOWED_TO_INVITE.includes(m.role as Role));
  if (!authorized) {
    console.warn('[invitations] forbidden_role', {
      user_id: user.id,
      roles: memberships.map((m) => m.role),
    });
    return { error: 'forbidden' };
  }

  // Paso 2: INSERT en invitations.
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

  // Paso 3: Supabase Invite (service role) — envía email y crea/upsert user
  // con flag invite_pending. El template "Invite user" del dashboard debe
  // contener `{{ .ConfirmationURL }}` que apunta a `redirectTo`.
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const next = `/${locale}/invite/${invite.token}`;
  const redirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(next)}`;

  console.info('[invitations][invite-email] sending', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
    redirectTo_origin: `${proto}://${host}`,
  });

  const admin = createSupabaseAdminClient();

  /**
   * Serializa un error del SDK Supabase (o cualquier objeto error-like) a un
   * objeto plano para console.error.
   *
   * Logueamos a console.error con un objeto JSON-stringificable porque Vercel
   * runtime logs no rinden bien objetos anidados; pasar string asegura que
   * todos los campos llegan en una línea grepable.
   *
   * NUNCA depender solo de Sentry.captureException — históricamente Sentry
   * ha estado roto en este proyecto y el único registro del error eran los
   * console.* en Vercel. Ver `docs/journey/known-issues.md`.
   */
  function serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      const anyErr = err as Error & {
        status?: number;
        code?: string;
        details?: unknown;
        hint?: unknown;
      };
      return {
        name: err.name,
        message: err.message,
        status: anyErr.status,
        code: anyErr.code,
        details: anyErr.details,
        hint: anyErr.hint,
        stack: err.stack,
      };
    }
    if (typeof err === 'object' && err !== null) {
      try {
        return JSON.parse(JSON.stringify(err));
      } catch {
        return { repr: String(err) };
      }
    }
    return { repr: String(err) };
  }

  try {
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo,
      data: { invite_pending: true, invitation_id: invite.id },
    });

    if (invErr) {
      // Si el user ya existe (email previo) Supabase devuelve un error.
      // En ese caso reenviamos el email de invitación vía resetPasswordForEmail
      // como vehículo de transporte para reusar la misma URL de redirect,
      // sin tener que reimplementar el template propio.
      const code = 'code' in invErr ? invErr.code : undefined;
      const alreadyExists =
        code === 'email_exists' ||
        invErr.message?.toLowerCase().includes('already been registered') ||
        invErr.message?.toLowerCase().includes('already exists');

      if (alreadyExists) {
        console.info('[invitations][invite-email] user_exists_falling_back_to_reset', {
          masked_email: maskedEmail,
          invitation_id: invite.id,
          original_error: serializeError(invErr),
        });
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
          redirectTo,
        });
        if (resetErr) {
          console.error(
            '[invitations][invite-email] reset_fallback_failed ' +
              JSON.stringify({
                step: 'resetPasswordForEmail_fallback',
                masked_email: maskedEmail,
                invitation_id: invite.id,
                error: serializeError(resetErr),
              })
          );
          Sentry.captureException(resetErr, {
            tags: { feature: 'invitations', step: 'reset_fallback' },
            extra: { masked_email: maskedEmail, invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        console.error(
          '[invitations][invite-email] invite_returned_error ' +
            JSON.stringify({
              step: 'inviteUserByEmail',
              masked_email: maskedEmail,
              invitation_id: invite.id,
              error: serializeError(invErr),
            })
        );
        Sentry.captureException(invErr, {
          tags: {
            feature: 'invitations',
            step: 'inviteUserByEmail',
            invite_status: String(invErr.status ?? 'unknown'),
          },
          extra: { masked_email: maskedEmail, invitation_id: invite.id },
        });
        return { error: 'generic' };
      }
    }
  } catch (thrown) {
    console.error(
      '[invitations][invite-email] invite_thrown ' +
        JSON.stringify({
          step: 'inviteUserByEmail',
          masked_email: maskedEmail,
          invitation_id: invite.id,
          error: serializeError(thrown),
        })
    );
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'inviteUserByEmail_thrown' },
      extra: { masked_email: maskedEmail, invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  console.info('[invitations][invite-email] sent', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
  });

  // Paso 4: si el rol es entrenador_ayudante, las capabilities se sembrarán al
  // crearse la membership en /invite/{token} (trigger ensure_assistant_capabilities).
  if (parsed.data.role === 'entrenador_ayudante') {
    console.info('[invitations] assistant_role_invited_capabilities_will_seed_on_accept', {
      invitation_id: invite.id,
    });
  }

  revalidatePath(`/${locale}/invitations`);
  return { ok: { email: parsed.data.email } };
}
