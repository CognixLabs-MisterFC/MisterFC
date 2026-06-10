'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import {
  acceptInvitationWithProfileSchema,
  createSupabaseServerClient,
  isSamePasswordError,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type AcceptInvitationState = {
  error?:
    | 'not_found'
    | 'expired'
    | 'already_accepted'
    | 'wrong_email'
    | 'invalid_input'
    | 'full_name_too_short'
    | 'full_name_too_long'
    | 'date_of_birth_invalid'
    | 'password_too_short'
    | 'password_mismatch'
    | 'no_session'
    // B1 — códigos específicos por punto de fallo (antes todo era 'generic').
    | 'auth_update_failed'
    | 'profile_update_failed'
    | 'membership_failed'
    | 'player_link_failed'
    | 'team_staff_failed'
    | 'generic';
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de diagnóstico
//
// Vercel runtime logs no rinden bien objetos anidados; pasamos strings JSON
// grepables por `[invite][accept]`. Sentry recibe las mismas excepciones con
// tags por step para poder filtrar incidencias en el dashboard.
// ─────────────────────────────────────────────────────────────────────────────

function maskEmail(email: string | null | undefined): string {
  if (!email) return 'none';
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

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

function logStep(step: string, payload: Record<string, unknown> = {}) {
  console.info(`[invite][accept] ${step} ` + JSON.stringify(payload));
}

function logError(step: string, error: unknown, extra: Record<string, unknown> = {}) {
  const serialized = serializeError(error);
  console.error(
    `[invite][accept] ${step} failed ` +
      JSON.stringify({ ...extra, error: serialized })
  );
  Sentry.captureException(error, {
    tags: { feature: 'invitations', step: `accept-${step}` },
    extra: { ...extra, error_summary: serialized },
  });
}

/**
 * Verifica la invitación y devuelve datos seguros para el caller. Centraliza
 * los chequeos de existencia / expiración / propietario para que las dos
 * server actions (con y sin password) compartan el mismo gate.
 */
async function loadAndAssertInvitation(token: string): Promise<
  | {
      ok: true;
      invitation: {
        id: string;
        club_id: string;
        role: string;
        email: string;
        player_id: string | null;
        player_relation: string | null;
        team_id: string | null;
        team_staff_role: string | null;
      };
    }
  | { ok: false; error: NonNullable<AcceptInvitationState['error']> }
> {
  logStep('fetch-invitation entered', { token_prefix: token.slice(0, 8) });
  const adapter = await createCookieAdapter();
  logStep('fetch-invitation adapter-ok', { token_prefix: token.slice(0, 8) });
  const supabase = createSupabaseServerClient(adapter);
  logStep('fetch-invitation client-ok', { token_prefix: token.slice(0, 8) });

  logStep('fetch-invitation start', { token_prefix: token.slice(0, 8) });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logStep('fetch-invitation no-session');
    return { ok: false, error: 'no_session' };
  }

  const { data: inv, error } = await supabase
    .from('invitations')
    .select(
      'id, email, club_id, role, expires_at, accepted_at, player_id, player_relation, team_id, team_staff_role'
    )
    .eq('token', token)
    .maybeSingle();

  if (error) {
    logError('fetch-invitation', error, {
      token_prefix: token.slice(0, 8),
      user_id: user.id,
    });
    return { ok: false, error: 'generic' };
  }
  if (!inv) {
    logStep('fetch-invitation not-found', { token_prefix: token.slice(0, 8) });
    return { ok: false, error: 'not_found' };
  }
  if (inv.accepted_at) {
    logStep('fetch-invitation already-accepted', { invitation_id: inv.id });
    return { ok: false, error: 'already_accepted' };
  }
  if (new Date(inv.expires_at) < new Date()) {
    logStep('fetch-invitation expired', {
      invitation_id: inv.id,
      expires_at: inv.expires_at,
    });
    return { ok: false, error: 'expired' };
  }
  if (
    !user.email ||
    user.email.trim().toLowerCase() !== inv.email.trim().toLowerCase()
  ) {
    logStep('fetch-invitation wrong-email', {
      invitation_id: inv.id,
      user_email_masked: maskEmail(user.email),
      invite_email_masked: maskEmail(inv.email),
    });
    return { ok: false, error: 'wrong_email' };
  }

  logStep('fetch-invitation ok', {
    invitation_id: inv.id,
    role: inv.role,
    has_player_id: !!inv.player_id,
    has_team_id: !!inv.team_id,
    has_team_staff_role: !!inv.team_staff_role,
  });

  return {
    ok: true,
    invitation: {
      id: inv.id,
      club_id: inv.club_id,
      role: inv.role,
      email: inv.email,
      player_id: inv.player_id,
      player_relation: inv.player_relation,
      team_id: inv.team_id,
      team_staff_role: inv.team_staff_role,
    },
  };
}

/**
 * Inserta membership + (si aplica) vínculo player_accounts + marca invitación
 * como aceptada. Asume que `loadAndAssertInvitation` ha validado todo antes.
 */
async function attachToClub(
  invitation: {
    id: string;
    club_id: string;
    role: string;
    player_id: string | null;
    player_relation: string | null;
    team_id: string | null;
    team_staff_role: string | null;
  },
  profileId: string
): Promise<AcceptInvitationState> {
  logStep('attach-to-club entered', { invitation_id: invitation.id });
  const adapter = await createCookieAdapter();
  logStep('attach-to-club adapter-ok', { invitation_id: invitation.id });
  const supabase = createSupabaseServerClient(adapter);
  logStep('attach-to-club client-ok', { invitation_id: invitation.id });

  logStep('membership-insert start', {
    invitation_id: invitation.id,
    role: invitation.role,
    club_id: invitation.club_id,
  });

  const { data: insertedMembership, error: mErr } = await supabase
    .from('memberships')
    .insert({
      profile_id: profileId,
      club_id: invitation.club_id,
      role: invitation.role,
    })
    .select('id')
    .single();

  let membershipId: string | null = insertedMembership?.id ?? null;

  if (mErr) {
    // 23505 = unique violation: membership ya existía. No es un error fatal;
    // seguimos para no dejar la invitación colgada en estado pendiente.
    if (mErr.code !== '23505') {
      logError('membership-insert', mErr, {
        invitation_id: invitation.id,
        pg_code: mErr.code,
        is_rls: mErr.code === '42501',
      });
      return { error: 'membership_failed' };
    }
    logStep('membership-insert duplicate-recovered', {
      invitation_id: invitation.id,
    });
    // Recuperar el membership ya existente para los inserts posteriores.
    const { data: existing, error: fetchErr } = await supabase
      .from('memberships')
      .select('id')
      .eq('profile_id', profileId)
      .eq('club_id', invitation.club_id)
      .maybeSingle();
    if (fetchErr) {
      logError('membership-refetch', fetchErr, { invitation_id: invitation.id });
      // No abortamos: seguimos sin membershipId; team_staff se omite abajo.
    }
    membershipId = existing?.id ?? null;
  } else {
    logStep('membership-insert ok', {
      invitation_id: invitation.id,
      membership_id: membershipId,
    });
  }

  // Si la invitación llevaba vinculación a jugador (tutor familiar), insertar
  // player_accounts. Solo aplicable cuando role=jugador + player_id presente
  // (el CHECK estructural de la migración F2.4 garantiza el resto).
  if (
    invitation.role === 'jugador' &&
    invitation.player_id &&
    invitation.player_relation
  ) {
    logStep('player-account-insert start', {
      invitation_id: invitation.id,
      player_id: invitation.player_id,
      relation: invitation.player_relation,
    });
    const { error: paErr } = await supabase.from('player_accounts').insert({
      player_id: invitation.player_id,
      profile_id: profileId,
      relation: invitation.player_relation as 'parent' | 'guardian',
    });
    if (paErr) {
      // 23505 = vínculo ya existía (caso poco probable: misma pareja
      // player+profile re-invitada). No abortamos.
      if (paErr.code !== '23505') {
        logError('player-account-insert', paErr, {
          invitation_id: invitation.id,
          player_id: invitation.player_id,
          pg_code: paErr.code,
          is_rls: paErr.code === '42501',
        });
        return { error: 'player_link_failed' };
      }
      logStep('player-account-insert duplicate-ignored', {
        invitation_id: invitation.id,
      });
    } else {
      logStep('player-account-insert ok', {
        invitation_id: invitation.id,
      });
    }
  }

  // F2.6: si la invitación llevaba team_id + team_staff_role, insertar
  // team_staff con la membership_id recién creada (o la existente).
  if (invitation.team_id && invitation.team_staff_role && membershipId) {
    logStep('team-staff-insert start', {
      invitation_id: invitation.id,
      team_id: invitation.team_id,
      team_staff_role: invitation.team_staff_role,
      membership_id: membershipId,
    });
    const { error: tsErr } = await supabase.from('team_staff').insert({
      team_id: invitation.team_id,
      membership_id: membershipId,
      staff_role: invitation.team_staff_role as
        | 'entrenador_principal'
        | 'entrenador_ayudante'
        | 'preparador_fisico'
        | 'delegado',
    });
    if (tsErr) {
      // 23505 = vínculo activo ya existía (mismo team+membership). No abortamos.
      if (tsErr.code !== '23505') {
        logError('team-staff-insert', tsErr, {
          invitation_id: invitation.id,
          team_id: invitation.team_id,
          pg_code: tsErr.code,
          is_rls: tsErr.code === '42501',
        });
        return { error: 'team_staff_failed' };
      }
      logStep('team-staff-insert duplicate-ignored', {
        invitation_id: invitation.id,
      });
    } else {
      logStep('team-staff-insert ok', {
        invitation_id: invitation.id,
      });
    }
  } else if (invitation.team_id && invitation.team_staff_role && !membershipId) {
    // Esto solo pasa si tras un 23505 no pudimos recuperar el membership_id.
    // Sin él, no podemos insertar team_staff — dejamos la invitación
    // semi-aceptada para que el admin pueda re-vincular manualmente.
    logStep('team-staff-insert skipped-no-membership', {
      invitation_id: invitation.id,
      team_id: invitation.team_id,
    });
    Sentry.captureMessage('[invite][accept] team-staff skipped: missing membership_id', {
      level: 'warning',
      tags: { feature: 'invitations', step: 'accept-team-staff-skipped' },
      extra: { invitation_id: invitation.id, team_id: invitation.team_id },
    });
  }

  logStep('mark-accepted start', { invitation_id: invitation.id });
  const { error: acceptErr } = await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);
  if (acceptErr) {
    // No es fatal: la membership ya está creada. Logueamos para detectar
    // invitaciones que quedan visibles como pendientes pese a haber sido
    // efectivas, y devolvemos OK.
    logError('mark-accepted', acceptErr, { invitation_id: invitation.id });
  } else {
    logStep('mark-accepted ok', { invitation_id: invitation.id });
  }

  return {};
}

/**
 * Flujo "invitee ya tiene password" (p.ej. pertenece a otro club).
 *
 * No pide nada al user, solo confirma con un click. Crea membership y marca
 * invitación como aceptada. No toca el perfil (el invitee ya lo rellenó cuando
 * se registró la primera vez).
 */
export async function acceptInvitation(
  locale: string,
  token: string
): Promise<AcceptInvitationState> {
  logStep('flow=quick entered', { token_prefix: token.slice(0, 8), locale });
  try {
    logStep('flow=quick start', { token_prefix: token.slice(0, 8), locale });

    logStep('flow=quick pre-gate');
    const gate = await loadAndAssertInvitation(token);
    logStep('flow=quick post-gate', { ok: gate.ok });
    if (!gate.ok) {
      if (gate.error === 'no_session') {
        redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
      }
      logStep('flow=quick aborted-by-gate', { gate_error: gate.error });
      return { error: gate.error };
    }

    logStep('flow=quick pre-getUser');
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    logStep('flow=quick post-getUser', { has_user: !!user });
    if (!user) {
      logStep('flow=quick no-session-after-gate');
      redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
    }

    logStep('flow=quick pre-attach', { invitation_id: gate.invitation.id });
    const result = await attachToClub(gate.invitation, user.id);
    logStep('flow=quick post-attach', { has_error: !!result.error });
    if (result.error) {
      logStep('flow=quick attach-failed', {
        invitation_id: gate.invitation.id,
        error: result.error,
      });
      return result;
    }

    logStep('flow=quick success', {
      invitation_id: gate.invitation.id,
      role: gate.invitation.role,
    });
    redirect(`/${locale}`);
  } catch (err) {
    // unstable_rethrow reenvía señales de framework (NEXT_REDIRECT, NOT_FOUND,
    // unauthorized) sin loguearlas como fallo. Si llegamos a la línea siguiente
    // es un throw inesperado de verdad.
    unstable_rethrow(err);
    logError('flow=quick unexpected-throw', err, {
      token_prefix: token.slice(0, 8),
      locale,
    });
    return { error: 'generic' };
  }
}

/**
 * Flujo "invitee viene del email de Supabase Invite — set password + perfil".
 *
 * El user llegó con sesión temporal (la creó el callback al canjear el OTP).
 * Le pedimos full_name, date_of_birth (opcional), password + confirm.
 *
 * Acciones:
 *  1. updateUser({ password, data: { full_name, date_of_birth, locale } }) —
 *     fija password y propaga datos a raw_user_meta_data.
 *  2. UPDATE profiles SET full_name, date_of_birth, locale WHERE id = auth.uid()
 *     — el trigger `handle_new_user` ya creó la fila pero solo con los datos
 *     pasados en `inviteUserByEmail` (que NO incluyen full_name). Hacemos UPDATE
 *     explícito para que el perfil quede coherente con lo que el invitee acaba
 *     de introducir.
 *  3. INSERT en memberships + UPDATE invitations.accepted_at.
 */
export async function acceptInvitationWithProfile(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  logStep('flow=with-profile entered', {
    token_prefix: token.slice(0, 8),
    locale,
  });
  try {
    logStep('flow=with-profile start', {
      token_prefix: token.slice(0, 8),
      locale,
    });

    logStep('flow=with-profile pre-parse', {
      has_full_name: formData.get('full_name') !== null,
      has_date_of_birth: formData.get('date_of_birth') !== null,
      has_password: formData.get('password') !== null,
      has_confirm: formData.get('confirm') !== null,
    });
    const parsed = acceptInvitationWithProfileSchema.safeParse({
      full_name: formData.get('full_name'),
      date_of_birth: formData.get('date_of_birth'),
      password: formData.get('password'),
      confirm: formData.get('confirm'),
    });
    logStep('flow=with-profile post-parse', { success: parsed.success });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const code = issue?.message ?? 'invalid_input';
      logStep('flow=with-profile invalid-input', {
        code,
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        })),
      });
      if (code === 'full_name_too_short') return { error: 'full_name_too_short' };
      if (code === 'full_name_too_long') return { error: 'full_name_too_long' };
      if (code === 'date_of_birth_invalid') return { error: 'date_of_birth_invalid' };
      if (code === 'password_too_short') return { error: 'password_too_short' };
      if (code === 'password_mismatch') return { error: 'password_mismatch' };
      return { error: 'invalid_input' };
    }

    logStep('flow=with-profile input-ok', {
      has_date_of_birth: !!parsed.data.date_of_birth,
      full_name_len: parsed.data.full_name.length,
    });

    logStep('flow=with-profile pre-gate');
    const gate = await loadAndAssertInvitation(token);
    logStep('flow=with-profile post-gate', { ok: gate.ok });
    if (!gate.ok) {
      if (gate.error === 'no_session') {
        redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
      }
      logStep('flow=with-profile aborted-by-gate', { gate_error: gate.error });
      return { error: gate.error };
    }

    logStep('flow=with-profile pre-getUser');
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    logStep('flow=with-profile post-getUser', { has_user: !!user });
    if (!user) {
      logStep('flow=with-profile no-session-after-gate');
      redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
    }

    // Paso 1: password + metadata en auth.users.
    logStep('auth-update start', { invitation_id: gate.invitation.id });
    const { error: updErr } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: {
        full_name: parsed.data.full_name,
        date_of_birth: parsed.data.date_of_birth,
        locale,
      },
    });
    if (updErr) {
      // B1 — IDEMPOTENCIA: si el fallo es "la nueva contraseña es igual a la
      // actual" (típico tras fijar la contraseña vía recovery y re-teclearla
      // aquí), NO es fatal: el invitee ya tiene la contraseña que quiere. Pero
      // el `data` (full_name/dob/locale) puede no haberse aplicado, así que lo
      // reintentamos sin password para no perder el perfil. El attachToClub
      // sigue después igual.
      if (isSamePasswordError(updErr)) {
        logStep('auth-update same-password-ignored', {
          invitation_id: gate.invitation.id,
        });
        const { error: metaErr } = await supabase.auth.updateUser({
          data: {
            full_name: parsed.data.full_name,
            date_of_birth: parsed.data.date_of_birth,
            locale,
          },
        });
        if (metaErr) {
          // El metadata no es crítico (el Paso 2 reescribe profiles igualmente);
          // logueamos y seguimos.
          logError('auth-update-metadata-only', metaErr, {
            invitation_id: gate.invitation.id,
          });
        } else {
          logStep('auth-update metadata-only ok', {
            invitation_id: gate.invitation.id,
          });
        }
      } else {
        logError('auth-update', updErr, {
          invitation_id: gate.invitation.id,
          user_email_masked: maskEmail(user.email),
        });
        return { error: 'auth_update_failed' };
      }
    } else {
      logStep('auth-update ok', { invitation_id: gate.invitation.id });
    }

    // Paso 2: UPDATE profiles.
    logStep('profile-update start', { invitation_id: gate.invitation.id });
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        full_name: parsed.data.full_name,
        date_of_birth: parsed.data.date_of_birth,
        locale,
      })
      .eq('id', user.id);
    if (profErr) {
      logError('profile-update', profErr, {
        invitation_id: gate.invitation.id,
        user_id: user.id,
        pg_code: profErr.code,
        is_rls: profErr.code === '42501',
      });
      return { error: 'profile_update_failed' };
    }
    logStep('profile-update ok', { invitation_id: gate.invitation.id });

    // Paso 3: membership + accept.
    logStep('flow=with-profile pre-attach', { invitation_id: gate.invitation.id });
    const result = await attachToClub(gate.invitation, user.id);
    logStep('flow=with-profile post-attach', { has_error: !!result.error });
    if (result.error) {
      logStep('flow=with-profile attach-failed', {
        invitation_id: gate.invitation.id,
        error: result.error,
      });
      return result;
    }

    logStep('flow=with-profile success', {
      invitation_id: gate.invitation.id,
      role: gate.invitation.role,
      type: gate.invitation.team_id
        ? 'staff'
        : gate.invitation.player_id
          ? 'tutor'
          : 'generic',
    });
    redirect(`/${locale}`);
  } catch (err) {
    // unstable_rethrow reenvía señales de framework (NEXT_REDIRECT, NOT_FOUND,
    // unauthorized) sin loguearlas como fallo. Si llegamos a la línea siguiente
    // es un throw inesperado de verdad.
    unstable_rethrow(err);
    logError('flow=with-profile unexpected-throw', err, {
      token_prefix: token.slice(0, 8),
      locale,
    });
    return { error: 'generic' };
  }
}
