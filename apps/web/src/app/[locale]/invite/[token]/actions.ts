'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import {
  acceptInvitationWithProfileSchema,
  assertInvitationValid,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSamePasswordError,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadInvitationByToken, type LoadedInvitation } from './invite-data';
import { loadCurrentLegalDocs, loadAccountConsentStatus } from './consent-data';

/** Flags de aceptación (T&C + Privacidad) enviados por el form del alta (F14-2). */
type ConsentAccepts = { terms: boolean; privacy: boolean };

function consentAcceptsFromForm(formData: FormData): ConsentAccepts {
  return {
    terms: formData.get('accept_terms') === 'true',
    privacy: formData.get('accept_privacy') === 'true',
  };
}

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
    // B2 — credenciales del invitee existente incorrectas (signInWithPassword).
    | 'wrong_credentials'
    // B1 — códigos específicos por punto de fallo (antes todo era 'generic').
    | 'auth_update_failed'
    | 'profile_update_failed'
    | 'membership_failed'
    | 'player_link_failed'
    | 'team_staff_failed'
    // F14-2 — faltan consentimientos obligatorios de cuenta (T&C / privacidad).
    | 'consent_required'
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

// ─────────────────────────────────────────────────────────────────────────────
// Gate por TOKEN (Rework B · B2)
//
// El token es la credencial. Validamos la invitación con el cliente service_role
// (sin requerir sesión previa) y delegamos los chequeos puros en
// `assertInvitationValid` (testeado en @misterfc/core). `authedEmail` se pasa
// solo en los flujos que ya tienen sesión (quick / existing) para exigir que el
// usuario autenticado coincida con el email invitado.
// ─────────────────────────────────────────────────────────────────────────────

async function gateByToken(
  token: string,
  authedEmail?: string | null
): Promise<
  | { ok: true; invitation: LoadedInvitation }
  | { ok: false; error: NonNullable<AcceptInvitationState['error']> }
> {
  logStep('gate fetch', { token_prefix: token.slice(0, 8) });
  const invitation = await loadInvitationByToken(token);
  const verdict = assertInvitationValid(invitation, Date.now(), authedEmail);
  if (verdict !== 'valid') {
    logStep('gate rejected', { token_prefix: token.slice(0, 8), verdict });
    return { ok: false, error: verdict };
  }
  // assertInvitationValid devolvió 'valid' ⇒ invitation no es null.
  return { ok: true, invitation: invitation as LoadedInvitation };
}

/**
 * F14-2 — Registra en el ledger `consents` los consentimientos OBLIGATORIOS de
 * cuenta (T&C + Privacidad) que aún NO estén aceptados en su versión vigente, a
 * nivel de cuenta (player_id NULL). Corre bajo la sesión del invitee (RLS: el
 * tutor inserta solo sus filas). ip/user_agent se capturan SIEMPRE en el
 * servidor (no se confía en el cliente). Idempotente: si ya estaba aceptada la
 * versión vigente NO reinserta. Si un obligatorio no aceptado llega sin flag →
 * 'consent_required' (defensivo; el botón del form ya gatea).
 */
async function recordAccountConsents(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  profileId: string,
  accepts: ConsentAccepts
): Promise<AcceptInvitationState> {
  const legal = await loadCurrentLegalDocs();
  const status = await loadAccountConsentStatus(
    profileId,
    legal.terms?.version ?? null,
    legal.privacy?.version ?? null
  );

  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? null) : null;
  const userAgent = h.get('user-agent');

  const rows: {
    tutor_profile_id: string;
    player_id: null;
    consent_type: 'terms_conditions' | 'privacy_policy';
    granted: true;
    legal_document_version: number;
    ip: string | null;
    user_agent: string | null;
  }[] = [];

  if (legal.terms && !status.termsAccepted) {
    if (!accepts.terms) return { error: 'consent_required' };
    rows.push({
      tutor_profile_id: profileId,
      player_id: null,
      consent_type: 'terms_conditions',
      granted: true,
      legal_document_version: legal.terms.version,
      ip,
      user_agent: userAgent,
    });
  }
  if (legal.privacy && !status.privacyAccepted) {
    if (!accepts.privacy) return { error: 'consent_required' };
    rows.push({
      tutor_profile_id: profileId,
      player_id: null,
      consent_type: 'privacy_policy',
      granted: true,
      legal_document_version: legal.privacy.version,
      ip,
      user_agent: userAgent,
    });
  }

  if (rows.length > 0) {
    logStep('consent-insert start', { profile_id: profileId, count: rows.length });
    const { error } = await supabase.from('consents').insert(rows);
    if (error) {
      logError('consent-insert', error, {
        profile_id: profileId,
        pg_code: error.code,
        is_rls: error.code === '42501',
      });
      return { error: 'generic' };
    }
    logStep('consent-insert ok', { profile_id: profileId, count: rows.length });
  }
  return {};
}

/**
 * Inserta membership + (si aplica) vínculo player_accounts + team_staff y marca
 * la invitación como aceptada. Corre bajo la sesión del invitee (RLS aplica):
 * las policies `*_insert_invitee` están diseñadas para que el propio invitee se
 * auto-inserte. El service_role NO se usa aquí.
 *
 * `mark-accepted` es condicional (`accepted_at IS NULL`) para hacer el token
 * single-use de forma robusta ante doble submit / carreras.
 *
 * F14-2 — ANTES de crear nada, registra los consentimientos obligatorios de
 * cuenta; si faltan, aborta sin escribir membership.
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
  profileId: string,
  accepts: ConsentAccepts
): Promise<AcceptInvitationState> {
  logStep('attach-to-club entered', { invitation_id: invitation.id });
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // F14-2 — consentimientos obligatorios de cuenta (T&C + Privacidad) primero.
  const consentResult = await recordAccountConsents(supabase, profileId, accepts);
  if (consentResult.error) return consentResult;

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
    const { data: existing, error: fetchErr } = await supabase
      .from('memberships')
      .select('id')
      .eq('profile_id', profileId)
      .eq('club_id', invitation.club_id)
      .maybeSingle();
    if (fetchErr) {
      logError('membership-refetch', fetchErr, { invitation_id: invitation.id });
    }
    membershipId = existing?.id ?? null;
  } else {
    logStep('membership-insert ok', {
      invitation_id: invitation.id,
      membership_id: membershipId,
    });
  }

  // Vínculo tutor↔jugador (role=jugador + player_id).
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
      logStep('player-account-insert ok', { invitation_id: invitation.id });
    }
  }

  // team_staff (team_id + team_staff_role).
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
      logStep('team-staff-insert ok', { invitation_id: invitation.id });
    }
  } else if (invitation.team_id && invitation.team_staff_role && !membershipId) {
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

  // Single-use: marca accepted_at solo si seguía pendiente.
  logStep('mark-accepted start', { invitation_id: invitation.id });
  const { error: acceptErr, count } = await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', invitation.id)
    .is('accepted_at', null);
  if (acceptErr) {
    logError('mark-accepted', acceptErr, { invitation_id: invitation.id });
  } else if ((count ?? 0) === 0) {
    // Carrera: otra ejecución ya la marcó. La membership ya existe; no es fatal.
    logStep('mark-accepted already-marked', { invitation_id: invitation.id });
  } else {
    logStep('mark-accepted ok', { invitation_id: invitation.id });
  }

  return {};
}

/**
 * Flujo QUICK — el invitee YA tiene sesión activa y su email coincide con la
 * invitación (lo decide la página). Un click: solo adjunta al club. No toca
 * contraseña ni perfil.
 */
export async function acceptInvitation(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  logStep('flow=quick entered', { token_prefix: token.slice(0, 8), locale });
  try {
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      logStep('flow=quick no-session');
      return { error: 'no_session' };
    }

    const gate = await gateByToken(token, user.email);
    if (!gate.ok) return { error: gate.error };

    const result = await attachToClub(
      gate.invitation,
      user.id,
      consentAcceptsFromForm(formData)
    );
    if (result.error) return result;

    logStep('flow=quick success', {
      invitation_id: gate.invitation.id,
      role: gate.invitation.role,
    });
    redirect(`/${locale}`);
  } catch (err) {
    unstable_rethrow(err);
    logError('flow=quick unexpected-throw', err, {
      token_prefix: token.slice(0, 8),
      locale,
    });
    return { error: 'generic' };
  }
}

/**
 * Flujo NEW INVITEE (Rework B · B2) — cuenta creada por nosotros vía
 * inviteUserByEmail y aún no reclamada (`invitations.invited_user_id` presente).
 *
 * El token es la credencial; NO se requiere sesión previa ni sobrevivir al
 * magic link. Pasos:
 *   1. Validar token (gate).
 *   2. admin.updateUserById(invited_user_id): fija contraseña + metadata y
 *      limpia `app_metadata.invite_pending` (estado real, sin flag rancio).
 *   3. signInWithPassword: crea la sesión del invitee (cookies) con la contraseña
 *      recién fijada.
 *   4. UPDATE profiles bajo esa sesión.
 *   5. attachToClub bajo esa sesión.
 *
 * El service_role solo aparece en (2): es lo único que fija contraseña.
 */
export async function acceptNewInvitee(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  logStep('flow=new entered', { token_prefix: token.slice(0, 8), locale });
  try {
    const parsed = acceptInvitationWithProfileSchema.safeParse({
      full_name: formData.get('full_name'),
      date_of_birth: formData.get('date_of_birth'),
      password: formData.get('password'),
      confirm: formData.get('confirm'),
    });
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? 'invalid_input';
      logStep('flow=new invalid-input', { code });
      if (code === 'full_name_too_short') return { error: 'full_name_too_short' };
      if (code === 'full_name_too_long') return { error: 'full_name_too_long' };
      if (code === 'date_of_birth_invalid') return { error: 'date_of_birth_invalid' };
      if (code === 'password_too_short') return { error: 'password_too_short' };
      if (code === 'password_mismatch') return { error: 'password_mismatch' };
      return { error: 'invalid_input' };
    }

    const gate = await gateByToken(token);
    if (!gate.ok) return { error: gate.error };
    const invitation = gate.invitation;

    if (!invitation.invited_user_id) {
      // Defensivo: la página solo debería enrutar aquí cuando hay cuenta no
      // reclamada. Si llega sin invited_user_id es un invitee existente → debe
      // iniciar sesión, no fijar contraseña (vector de secuestro). Abortamos.
      logError(
        'flow=new no-invited-user',
        new Error('acceptNewInvitee on invitation without invited_user_id'),
        { invitation_id: invitation.id }
      );
      return { error: 'auth_update_failed' };
    }

    const admin = createSupabaseAdminClient();

    // Paso 1+2: fija contraseña + metadata + limpia invite_pending sobre la
    // cuenta no reclamada que creamos para esta invitación.
    logStep('flow=new admin-set-password start', { invitation_id: invitation.id });
    const { error: updErr } = await admin.auth.admin.updateUserById(
      invitation.invited_user_id,
      {
        password: parsed.data.password,
        user_metadata: {
          full_name: parsed.data.full_name,
          date_of_birth: parsed.data.date_of_birth,
          locale,
        },
        app_metadata: { invite_pending: false },
      }
    );
    if (updErr && !isSamePasswordError(updErr)) {
      logError('flow=new admin-set-password', updErr, {
        invitation_id: invitation.id,
        user_email_masked: maskEmail(invitation.email),
      });
      return { error: 'auth_update_failed' };
    }
    if (updErr) {
      // Contraseña ya era esa (re-claim idempotente): aseguramos metadata sin tocarla.
      logStep('flow=new admin-set-password same-password-ignored', {
        invitation_id: invitation.id,
      });
      await admin.auth.admin.updateUserById(invitation.invited_user_id, {
        user_metadata: {
          full_name: parsed.data.full_name,
          date_of_birth: parsed.data.date_of_birth,
          locale,
        },
        app_metadata: { invite_pending: false },
      });
    } else {
      logStep('flow=new admin-set-password ok', { invitation_id: invitation.id });
    }

    // Paso 3: crea sesión con la contraseña recién fijada.
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    logStep('flow=new sign-in start', { invitation_id: invitation.id });
    const { data: signInData, error: signInErr } =
      await supabase.auth.signInWithPassword({
        email: invitation.email,
        password: parsed.data.password,
      });
    const user = signInData?.user ?? null;
    if (signInErr || !user) {
      logError('flow=new sign-in', signInErr ?? new Error('no user after sign-in'), {
        invitation_id: invitation.id,
        user_email_masked: maskEmail(invitation.email),
      });
      return { error: 'auth_update_failed' };
    }
    logStep('flow=new sign-in ok', { invitation_id: invitation.id });

    // Paso 4: profiles bajo la sesión del invitee.
    logStep('flow=new profile-update start', { invitation_id: invitation.id });
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        full_name: parsed.data.full_name,
        date_of_birth: parsed.data.date_of_birth,
        locale,
      })
      .eq('id', user.id);
    if (profErr) {
      logError('flow=new profile-update', profErr, {
        invitation_id: invitation.id,
        user_id: user.id,
        pg_code: profErr.code,
        is_rls: profErr.code === '42501',
      });
      return { error: 'profile_update_failed' };
    }
    logStep('flow=new profile-update ok', { invitation_id: invitation.id });

    // Paso 5: attach (+ consentimientos de cuenta).
    const result = await attachToClub(
      invitation,
      user.id,
      consentAcceptsFromForm(formData)
    );
    if (result.error) return result;

    logStep('flow=new success', {
      invitation_id: invitation.id,
      role: invitation.role,
      type: invitation.team_id ? 'staff' : invitation.player_id ? 'tutor' : 'generic',
    });
    redirect(`/${locale}`);
  } catch (err) {
    unstable_rethrow(err);
    logError('flow=new unexpected-throw', err, {
      token_prefix: token.slice(0, 8),
      locale,
    });
    return { error: 'generic' };
  }
}

/**
 * Flujo EXISTING USER (Rework B · B2) — el email YA tenía cuenta
 * (`invitations.invited_user_id` NULL). El token NO puede resetear su contraseña
 * ni crear sesión por sí mismo: el invitee se autentica con SU contraseña y el
 * token solo le adjunta al club. Cierra el vector de secuestro de cuentas.
 */
export async function acceptExistingUser(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  logStep('flow=existing entered', { token_prefix: token.slice(0, 8), locale });
  try {
    const password = formData.get('password');
    if (typeof password !== 'string' || password.length === 0) {
      return { error: 'invalid_input' };
    }

    const gate = await gateByToken(token);
    if (!gate.ok) return { error: gate.error };
    const invitation = gate.invitation;

    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);

    logStep('flow=existing sign-in start', { invitation_id: invitation.id });
    const { data: signInData, error: signInErr } =
      await supabase.auth.signInWithPassword({
        email: invitation.email,
        password,
      });
    const user = signInData?.user ?? null;
    if (signInErr || !user) {
      // Credenciales incorrectas: NO es genérico, es el caso esperado de password mal.
      logStep('flow=existing wrong-credentials', {
        invitation_id: invitation.id,
        user_email_masked: maskEmail(invitation.email),
      });
      return { error: 'wrong_credentials' };
    }

    // Defensa en profundidad: el usuario autenticado debe coincidir con el email
    // invitado (signInWithPassword usa invitation.email, pero lo reconfirmamos).
    if (
      !user.email ||
      user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()
    ) {
      logStep('flow=existing email-mismatch', { invitation_id: invitation.id });
      return { error: 'wrong_email' };
    }
    logStep('flow=existing sign-in ok', { invitation_id: invitation.id });

    const result = await attachToClub(
      invitation,
      user.id,
      consentAcceptsFromForm(formData)
    );
    if (result.error) return result;

    logStep('flow=existing success', {
      invitation_id: invitation.id,
      role: invitation.role,
    });
    redirect(`/${locale}`);
  } catch (err) {
    unstable_rethrow(err);
    logError('flow=existing unexpected-throw', err, {
      token_prefix: token.slice(0, 8),
      locale,
    });
    return { error: 'generic' };
  }
}
