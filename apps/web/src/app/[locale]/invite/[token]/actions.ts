'use server';

import { randomUUID } from 'node:crypto';
import { redirect, unstable_rethrow } from 'next/navigation';
import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import {
  acceptInvitationWithProfileSchema,
  assertInvitationValid,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSamePasswordError,
  playerPhotoUploadSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import {
  loadInvitationByToken,
  loadPendingInvitationsForEmail,
  type LoadedInvitation,
} from './invite-data';

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
    // F14-3c — imagen obligatoria por hijo / decisiones de imagen sin responder.
    | 'image_required'
    | 'image_decision_required'
    // Rework C/D — confirmación de datos del hijo (nombre + fecha nac.).
    | 'child_name_required'
    | 'child_dob_invalid'
    | 'generic';
};

/** F14-3c — mime → extensión para el path del bucket player-photos. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Rework C/D — validación de la fecha de nacimiento del hijo confirmada por el
 * tutor. Mismo criterio que el alta (yyyy-mm-dd, >= 1900, no futura).
 */
function isValidChildDob(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  if (year < 1900) return false;
  if (d.getTime() > Date.now()) return false;
  return true;
}

type ChildUpdate = {
  playerId: string;
  first_name: string;
  last_name: string | null;
  date_of_birth: string;
};

/**
 * Rework C/D — parsea y valida los datos de hijo confirmados por el tutor
 * (campo `children_data`, JSON). Ancla al server: solo acepta player_ids que
 * estén entre las invitaciones PENDIENTES de este email+club (anti-tamper).
 * Devuelve la lista a persistir, o un código de error de validación.
 */
async function parseChildUpdates(
  clicked: LoadedInvitation,
  formData: FormData,
): Promise<
  | { ok: true; updates: ChildUpdate[] }
  | { ok: false; error: NonNullable<AcceptInvitationState['error']> }
> {
  const raw = formData.get('children_data');
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: true, updates: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_input' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'invalid_input' };

  const pending = await loadPendingInvitationsForEmail(clicked.email, clicked.club_id);
  const allowed = new Set(
    pending.map((p) => p.player_id).filter((x): x is string => !!x),
  );

  const updates: ChildUpdate[] = [];
  for (const entry of parsed) {
    const rec = entry as Record<string, unknown>;
    const pid = String(rec?.playerId ?? '');
    if (!allowed.has(pid)) continue; // ignora ids ajenos al lote pendiente
    const first = String(rec?.firstName ?? '').trim();
    const last = String(rec?.lastName ?? '').trim();
    const dob = String(rec?.dob ?? '').trim();
    if (first.length === 0 || first.length > 80) return { ok: false, error: 'child_name_required' };
    if (last.length > 120) return { ok: false, error: 'child_name_required' };
    if (!isValidChildDob(dob)) return { ok: false, error: 'child_dob_invalid' };
    updates.push({
      playerId: pid,
      first_name: first,
      last_name: last.length > 0 ? last : null,
      date_of_birth: dob,
    });
  }
  return { ok: true, updates };
}

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
    `[invite][accept] ${step} failed ` + JSON.stringify({ ...extra, error: serialized }),
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
  authedEmail?: string | null,
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
 * F14-3a — Alta MULTI-HIJO ATÓMICA. Una sola llamada a la RPC
 * `accept_pending_invitations` = una transacción de Postgres: registra los
 * consentimientos de cuenta (T&C + Privacidad) y procesa TODAS las invitaciones
 * pendientes del email del padre en el club del token clicado (membership +
 * player_accounts + team_staff + mark-accepted). TODO O NADA: un fallo real
 * revierte el lote completo; la idempotencia por fila tolera el doble submit.
 *
 * El GUARD (auth.uid() ↔ email de la invitación) vive DENTRO de la RPC
 * (SECURITY DEFINER); NO se pasa el email por parámetro. ip/user_agent se
 * capturan server-side como auditoría del consentimiento. La RPC lanza
 * mensajes-código (RAISE) que aquí mapeamos a AcceptInvitationState.
 */
async function attachAllPending(
  clicked: LoadedInvitation,
  formData: FormData,
): Promise<AcceptInvitationState> {
  logStep('attach-all entered', {
    invitation_id: clicked.id,
    club_id: clicked.club_id,
  });
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const accepts = consentAcceptsFromForm(formData);

  // Rework C/D — validar los datos del hijo confirmados por el tutor ANTES de
  // subir imágenes / llamar a la RPC: si son inválidos salimos sin efectos
  // secundarios. La persistencia se hace tras aceptar (más abajo).
  const childParse = await parseChildUpdates(clicked, formData);
  if (!childParse.ok) return { error: childParse.error };

  // Metadatos de auditoría (no se confía en el cliente).
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? null) : null;
  const userAgent = h.get('user-agent');

  // F14-3c — Subida de imágenes ANTES de la RPC, server-side con admin: en este
  // instante el vínculo player_accounts aún no existe (la RPC lo crea), así que
  // el tutor no pasaría la RLS de storage. Recogemos player_ids de los campos
  // `image_file_<pid>`. Si la RPC revierte o algo falla → borramos lo subido.
  const admin = createSupabaseAdminClient();
  const uploadedPaths: string[] = [];
  const children: Record<string, { internal: boolean; social: boolean; path: string }> = {};
  // F14-4 — decisiones médicas por hijo (opcionales, no gatean). Solo se incluye
  // el hijo si el tutor respondió sí/no explícito.
  const medical: Record<
    string,
    {
      consent: boolean;
      allergies?: string;
      medication?: string;
      medical_conditions?: string;
      emergency_contact?: string;
    }
  > = {};

  function medField(pid: string, key: string): string | undefined {
    const v = formData.get(`${key}_${pid}`);
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 2000) : undefined;
  }

  const playerIds = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith('image_file_')) playerIds.add(key.slice('image_file_'.length));
  }

  async function cleanupImages() {
    if (uploadedPaths.length === 0) return;
    try {
      await admin.storage.from('player-photos').remove(uploadedPaths);
    } catch (rmErr) {
      logError('image-cleanup', rmErr, { paths: uploadedPaths.length });
    }
  }

  try {
    for (const pid of playerIds) {
      const internalRaw = formData.get(`image_internal_${pid}`);
      const socialRaw = formData.get(`image_social_${pid}`);
      // Decisiones explícitas (sí/no); guard server-side, no se confía en la UI.
      if (internalRaw !== 'yes' && internalRaw !== 'no') return { error: 'image_decision_required' };
      if (socialRaw !== 'yes' && socialRaw !== 'no') return { error: 'image_decision_required' };

      const file = formData.get(`image_file_${pid}`);
      if (!(file instanceof File) || file.size === 0) return { error: 'image_required' };
      const valid = playerPhotoUploadSchema.safeParse({ mimeType: file.type, size: file.size });
      if (!valid.success) return { error: 'image_required' };

      const ext = MIME_TO_EXT[file.type] ?? 'jpg';
      const path = `${pid}/${randomUUID()}.${ext}`;
      const { error: upErr } = await admin.storage
        .from('player-photos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        logError('image-upload', upErr, { player_id: pid });
        await cleanupImages();
        return { error: 'generic' };
      }
      uploadedPaths.push(path);
      children[pid] = {
        internal: internalRaw === 'yes',
        social: socialRaw === 'yes',
        path,
      };

      // F14-4 — consentimiento médico (opcional). Solo si respondió sí/no.
      const medicalRaw = formData.get(`medical_consent_${pid}`);
      if (medicalRaw === 'yes' || medicalRaw === 'no') {
        medical[pid] = {
          consent: medicalRaw === 'yes',
          allergies: medField(pid, 'med_allergies'),
          medication: medField(pid, 'med_medication'),
          medical_conditions: medField(pid, 'med_conditions'),
          emergency_contact: medField(pid, 'med_emergency'),
        };
      }
    }

    const { data, error } = await supabase.rpc('accept_pending_invitations', {
      p_clicked_token: clicked.token,
      p_accept_terms: accepts.terms,
      p_accept_privacy: accepts.privacy,
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
      p_children: children,
      p_medical: medical,
    });

    if (error) {
      // La transacción revirtió: no dejamos imágenes huérfanas en el bucket.
      await cleanupImages();
      const msg = error.message ?? '';
      if (msg.includes('consent_required')) return { error: 'consent_required' };
      if (msg.includes('wrong_email')) return { error: 'wrong_email' };
      if (msg.includes('not_found')) return { error: 'not_found' };
      if (msg.includes('no_session')) return { error: 'no_session' };
      if (msg.includes('image_decision_required')) return { error: 'image_decision_required' };
      if (msg.includes('image_required')) return { error: 'image_required' };
      logError('rpc accept_pending', error, {
        invitation_id: clicked.id,
        pg_code: error.code,
      });
      return { error: 'generic' };
    }

    // Rework C/D — persistir nombre + fecha nac. del hijo confirmados por el
    // tutor. Best-effort tras la aceptación ya comprometida (admin/service_role:
    // el vínculo player_accounts se acaba de crear en la RPC). Un fallo aquí no
    // tumba la aceptación (ya hecha); se registra.
    for (const u of childParse.updates) {
      const { error: pErr } = await admin
        .from('players')
        .update({
          first_name: u.first_name,
          last_name: u.last_name,
          date_of_birth: u.date_of_birth,
        })
        .eq('id', u.playerId)
        .eq('club_id', clicked.club_id);
      if (pErr) {
        logError('child-data-update', pErr, { player_id: u.playerId });
      }
    }

    logStep('attach-all done', { invitation_id: clicked.id, processed: data ?? 0 });
    return {};
  } catch (err) {
    // Fallo inesperado (p.ej. red): limpiamos antes de propagar.
    await cleanupImages();
    throw err;
  }
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
  formData: FormData,
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

    const result = await attachAllPending(gate.invitation, formData);
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
 *   5. attachAllPending bajo esa sesión (lote multi-hijo).
 *
 * El service_role solo aparece en (2): es lo único que fija contraseña.
 */
export async function acceptNewInvitee(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData,
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
        { invitation_id: invitation.id },
      );
      return { error: 'auth_update_failed' };
    }

    const admin = createSupabaseAdminClient();

    // Paso 1+2: fija contraseña + metadata + limpia invite_pending sobre la
    // cuenta no reclamada que creamos para esta invitación.
    logStep('flow=new admin-set-password start', { invitation_id: invitation.id });
    const { error: updErr } = await admin.auth.admin.updateUserById(invitation.invited_user_id, {
      password: parsed.data.password,
      user_metadata: {
        full_name: parsed.data.full_name,
        date_of_birth: parsed.data.date_of_birth,
        locale,
      },
      app_metadata: { invite_pending: false },
    });
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
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
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

    // Paso 5: attach de TODO el lote multi-hijo (+ consentimientos de cuenta).
    const result = await attachAllPending(invitation, formData);
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
  formData: FormData,
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
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
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
    if (!user.email || user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      logStep('flow=existing email-mismatch', { invitation_id: invitation.id });
      return { error: 'wrong_email' };
    }
    logStep('flow=existing sign-in ok', { invitation_id: invitation.id });

    const result = await attachAllPending(invitation, formData);
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
