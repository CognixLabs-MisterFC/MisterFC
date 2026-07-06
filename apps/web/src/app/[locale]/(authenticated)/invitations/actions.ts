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

// Quién puede invitar (a roles bajos). director = admin en gestión de roles bajos.
const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'director', 'coordinador'];
// Roles "altos": invitarlos es EXCLUSIVO del owner del club (F1B-2). La RLS
// invitations_insert_admin lo impone; este check es el pre-gate server-side.
const HIGH_ROLES: Role[] = ['admin_club', 'director'];

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

  // F1B-2: invitar con un rol ALTO (admin_club/director) es exclusivo del owner
  // del club. Pre-gate server-side (la RLS invitations_insert_admin lo reimpone).
  if (HIGH_ROLES.includes(parsed.data.role as Role)) {
    const { data: club } = await supabase
      .from('clubs')
      .select('owner_profile_id')
      .eq('id', authorized.club_id)
      .single();
    if (!club || club.owner_profile_id !== user.id) {
      console.warn('[invitations] forbidden_high_role_requires_owner', {
        user_id: user.id,
        role: parsed.data.role,
      });
      return { error: 'forbidden' };
    }
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
  // redirectTo apunta directamente a la página de invitación: Supabase verify
  // anexará `?code=<...>` (PKCE) o `?token_hash=<...>` (OTP), y la página se
  // encarga de intercambiar el artefacto por sesión antes de mostrar el form.
  // Antes pasábamos por /auth/callback, pero si la URL no estaba en la allowlist
  // de Supabase, caía silenciosamente al Site URL (raíz) y el code se perdía.
  const redirectTo = `${proto}://${host}/${locale}/invite/${invite.token}`;

  console.info('[invitations][invite-email] sending', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
    redirectTo,
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
    const { data: inviteData, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      },
    );

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
    } else {
      // Cuenta creada por nosotros para esta invitación (aún no reclamada).
      // Guardamos su auth.users.id en `invited_user_id`: Rework B · B2 lo usa
      // para fijar la contraseña SOLO sobre esta cuenta al aceptar por token.
      // Si el email ya existía caímos en la rama `alreadyExists` y NO entramos
      // aquí → invited_user_id queda NULL → invitee existente (inicia sesión).
      const invitedUserId = inviteData?.user?.id ?? null;
      if (invitedUserId) {
        const { error: linkErr } = await admin
          .from('invitations')
          .update({ invited_user_id: invitedUserId })
          .eq('id', invite.id);
        if (linkErr) {
          // No es fatal para el envío del email: logueamos. Sin invited_user_id
          // el accept tratará al invitee como "existente" (le pedirá sign-in),
          // peor UX pero no rompe.
          console.error(
            '[invitations][invite-email] link_invited_user_failed ' +
              JSON.stringify({
                step: 'link_invited_user',
                masked_email: maskedEmail,
                invitation_id: invite.id,
                error: serializeError(linkErr),
              })
          );
          Sentry.captureException(linkErr, {
            tags: { feature: 'invitations', step: 'link_invited_user' },
            extra: { masked_email: maskedEmail, invitation_id: invite.id },
          });
        } else {
          console.info('[invitations][invite-email] invited_user_linked', {
            masked_email: maskedEmail,
            invitation_id: invite.id,
          });
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// cancelInvitation — F2.6 hotfix 2026-05-30
// ─────────────────────────────────────────────────────────────────────────────

export type CancelInvitationResult = {
  ok?: { email: string };
  error?: 'not_found' | 'already_accepted' | 'forbidden' | 'generic';
};

/**
 * Borra una invitación pendiente o expirada. Permisos delegados al policy RLS
 * `invitations_delete_managers` (inviter + admin/coord del club + principal
 * del team referenciado). El server verifica además que `accepted_at IS NULL`
 * para impedir borrar invitaciones ya aceptadas — esas generaron memberships
 * reales y el camino para revocar acceso es removeStaff / removeFamilyLink.
 *
 * Revalida la vista correcta según la invitación:
 *   - club-level → /invitations
 *   - team-level (team_id) → /equipos/[teamId]
 *   - player-level (player_id) → /jugadores/[playerId]
 *
 * El cliente borra optimista la fila en su lista; si el server devuelve error,
 * vuelve a mostrarla.
 */
export async function cancelInvitation(
  locale: string,
  invitationId: string,
): Promise<CancelInvitationResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // SELECT primero para validar estado y poder revalidar paths correctos.
  // RLS de SELECT ya filtra invitaciones que el user no debería ver; si vuelve
  // null lo tratamos como not_found (no leakeamos existencia).
  const { data: invite, error: selErr } = await supabase
    .from('invitations')
    .select('id, email, accepted_at, team_id, player_id, club_id')
    .eq('id', invitationId)
    .maybeSingle();

  if (selErr) {
    Sentry.captureException(selErr, {
      tags: { feature: 'invitations', step: 'cancel_select' },
      extra: { invitation_id: invitationId },
    });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'not_found' };

  if (invite.accepted_at) return { error: 'already_accepted' };

  const { error: delErr, count } = await supabase
    .from('invitations')
    .delete({ count: 'exact' })
    .eq('id', invitationId);

  if (delErr) {
    // 42501 = insufficient privilege — el RLS rechazó al user. No es genérico.
    if (delErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(delErr, {
      tags: { feature: 'invitations', step: 'cancel_delete' },
      extra: { invitation_id: invitationId },
    });
    return { error: 'generic' };
  }
  // Sin error pero count=0: RLS dejó pasar el query pero ningún row matchea
  // (puede ser una race con un cancel simultáneo). Lo tratamos como forbidden
  // para no engañar al cliente con un "ok" falso.
  if (count === 0) return { error: 'forbidden' };

  console.info('[invitations] cancelled', {
    invitation_id: invitationId,
    masked_email: maskEmail(invite.email),
  });

  // Revalidar todas las rutas donde esta invitación pudiera estar listada.
  revalidatePath(`/${locale}/invitations`);
  if (invite.team_id) revalidatePath(`/${locale}/equipos/${invite.team_id}`);
  if (invite.player_id) revalidatePath(`/${locale}/jugadores/${invite.player_id}`);

  return { ok: { email: invite.email } };
}
