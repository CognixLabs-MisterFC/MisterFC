'use server';

import { randomUUID } from 'node:crypto';
import { redirect, unstable_rethrow } from 'next/navigation';
import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import {
  acceptInvitationWithProfileSchema,
  acceptPendingInvitationsFromClient,
  claimInviteeAccount,
  assertInvitationValid,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isInvitePending,
  playerIdsFromFormKeys,
  playerPhotoUploadSchema,
  // Rework C/D — la regla de los datos del hijo la usan LOS DOS lados (este
  // server y el validador del formulario). Una sola copia, en core: si se
  // tocara aquí, el aviso del cliente diría otra cosa que el servidor.
  validateChildRow,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { clientIpFrom } from '@/lib/client-ip';
import { emitInAppNotificationFanOut } from '@/lib/notify-bus';
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
    // Teléfono del tutor: OBLIGATORIO en el alta (y solo aquí).
    | 'phone_missing'
    | 'phone_invalid'
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
    // BC-6 — quien tiene un borrado de cuenta en curso no puede entrar en un club
    // nuevo. Lo decide la RPC (punto común de TODA aceptación), no la pantalla.
    | 'account_deletion_in_progress'
    // MN-3 — la cuenta propia del jugador no trae datos reservados al tutor. Desde
    // la pantalla no se llega (MN-5 no pinta esas tarjetas), pero la RPC está
    // expuesta a `authenticated` y su error tiene que tener nombre propio: si
    // cayera en 'generic' nadie sabría qué mirar.
    | 'reserved_for_tutor'
    | 'generic';
};

/** F14-3c — mime → extensión para el path del bucket player-photos. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
    const verdict = validateChildRow({ firstName: first, lastName: last, dob });
    if (verdict) return { ok: false, error: verdict };
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

  // Metadatos de auditoría (no se confía en el cliente). La IP sale del mismo sitio
  // que usa el límite de intentos de R-2: si divergieran, un día dirían cosas
  // distintas sobre el mismo intento.
  const h = await headers();
  const ip = clientIpFrom(h);
  const userAgent = h.get('user-agent');

  // F14-3c — Subida de imágenes ANTES de la RPC, server-side con admin: en este
  // instante el vínculo player_accounts aún no existe (la RPC lo crea), así que
  // el tutor no pasaría la RLS de storage. Recogemos player_ids de los campos
  // `image_file_<pid>`. Si la RPC revierte o algo falla → borramos lo subido.
  const admin = createSupabaseAdminClient();

  // D6 — invitaciones de ENTRENADOR pendientes de este email+club (las que el RPC va a
  // aceptar como coach: tienen team_staff_role). Se capturan ANTES del RPC porque tras
  // aceptar dejan de estar `pending`. Sirven para avisar a dirección (una novedad por
  // lote, no una por invitación) tras el éxito de la aceptación.
  const { data: coachInvsBefore } = await admin
    .from('invitations')
    .select('id, teams(name)')
    .eq('club_id', clicked.club_id)
    .ilike('email', clicked.email)
    .not('team_staff_role', 'is', null)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());

  const uploadedPaths: string[] = [];
  const children: Record<string, { internal: boolean; social: boolean; path?: string }> = {};
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

  // Los hijos del lote se deducen del campo de la DECISIÓN, no del de la foto:
  // el selector de fichero ya no se pinta cuando el tutor dice NO. La deducción
  // vive en core y está cubierta por tests (playerIdsFromFormKeys).
  const playerIds = playerIdsFromFormKeys(formData.keys());

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

      // F14-3c (revisión) — la foto es OPCIONAL. Sin fichero se sigue adelante y
      // el hijo viaja sin `path`; la RPC deja su photo_url como estuviera.
      const file = formData.get(`image_file_${pid}`);
      const hasFile = file instanceof File && file.size > 0;
      let path: string | undefined;

      if (hasFile) {
        // Si SÍ manda fichero, tiene que ser válido: un mime o un tamaño fuera de
        // rango es un error de verdad, no un "no quiero foto".
        const valid = playerPhotoUploadSchema.safeParse({ mimeType: file.type, size: file.size });
        if (!valid.success) return { error: 'image_required' };

        const ext = MIME_TO_EXT[file.type] ?? 'jpg';
        path = `${pid}/${randomUUID()}.${ext}`;
        const { error: upErr } = await admin.storage
          .from('player-photos')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          logError('image-upload', upErr, { player_id: pid });
          await cleanupImages();
          return { error: 'generic' };
        }
        uploadedPaths.push(path);
      }

      children[pid] = {
        internal: internalRaw === 'yes',
        social: socialRaw === 'yes',
        ...(path ? { path } : {}),
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

    // R-1 — la llamada y el MAPEO de su error viven en core: por esta RPC pasan las
    // tres acciones del alta (acceptInvitation / acceptNewInvitee /
    // acceptExistingUser) y ahora tambien la pantalla nativa. En cualquiera de ellas
    // el mapeo se quedaria a medias. Lo de alrededor —imagenes, datos del hijo, aviso
    // a direccion— sigue aqui porque es de la web y solo de la web.
    const attached = await acceptPendingInvitationsFromClient(supabase, {
      token: clicked.token,
      accepts,
      audit: { ip, userAgent },
      children,
      medical,
    });

    if ('error' in attached) {
      // La transacción revirtió: no dejamos imágenes huérfanas en el bucket.
      await cleanupImages();
      if (attached.error === 'generic') {
        logError('rpc accept_pending', attached.raw, { invitation_id: clicked.id });
      }
      return { error: attached.error };
    }
    const data = attached.ok.processed;

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

    // D6 — novedad a dirección (in_app, SIN push) si el que aceptó es un ENTRENADOR.
    // Best-effort: va DESPUÉS de la aceptación ya comprometida y NUNCA lanza — un fallo
    // aquí no puede dejar la invitación sin aceptar (ya está hecha).
    if (coachInvsBefore && coachInvsBefore.length > 0) {
      await notifyCoachInvitationAccepted(admin, supabase, clicked, coachInvsBefore).catch(
        (e) => logError('notify-coach-accepted', e, { invitation_id: clicked.id }),
      );
    }

    logStep('attach-all done', { invitation_id: clicked.id, processed: data ?? 0 });
    return {};
  } catch (err) {
    // Fallo inesperado (p.ej. red): limpiamos antes de propagar.
    await cleanupImages();
    throw err;
  }
}

/** Nombre de equipo del join `teams(name)` de PostgREST (objeto, array o null). */
function teamNameOf(raw: unknown): string | null {
  const t = Array.isArray(raw) ? (raw[0] ?? null) : raw;
  const name = (t as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * D6 — emite la novedad `coach_invitation_accepted` (in_app, SIN push) a admin_club y
 * directores del club cuando un ENTRENADOR acepta su invitación. UNA novedad por lote
 * (dedupe por el conjunto de ids de invitación de coach), no una por invitación; el
 * aceptante no se auto-notifica. Best-effort: la llama un `.catch` en attachAllPending,
 * así que un fallo no afecta a la aceptación ya comprometida.
 */
async function notifyCoachInvitationAccepted(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  supabase: ReturnType<typeof createSupabaseServerClient>,
  clicked: LoadedInvitation,
  coachInvs: ReadonlyArray<{ id: string; teams: unknown }>,
): Promise<void> {
  // Aceptante (para excluirlo de destinatarios y componer el nombre).
  const { data: userData } = await supabase.auth.getUser();
  const acceptingUid = userData.user?.id ?? clicked.invited_user_id ?? null;

  // Nombre a pintar: full_name del aceptante, con fallback al email (siempre presente).
  let name = clicked.email;
  if (acceptingUid) {
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', acceptingUid)
      .maybeSingle();
    if (prof?.full_name) name = prof.full_name;
  }

  // Equipo solo cuando es UNO (con varios, el texto va sin equipo).
  const teamName = coachInvs.length === 1 ? teamNameOf(coachInvs[0]?.teams) : null;

  // Destinatarios: admin_club + directores del club; el aceptante no se auto-notifica.
  const { data: recipRows } = await admin
    .from('memberships')
    .select('profile_id')
    .eq('club_id', clicked.club_id)
    .in('role', ['admin_club', 'director']);
  const recipients = (recipRows ?? [])
    .map((r) => r.profile_id)
    .filter((pid): pid is string => Boolean(pid) && pid !== acceptingUid);
  if (recipients.length === 0) return;

  // Dedupe por el CONJUNTO de invitaciones de coach del lote (ordenado) → una sola
  // novedad por lote, idempotente ante doble submit.
  const coachIds = coachInvs.map((c) => c.id).sort();
  await emitInAppNotificationFanOut(
    recipients.map((pid) => ({ user_id: pid })),
    {
      type: 'coach_invitation_accepted',
      in_app_payload: teamName ? { name, team_name: teamName } : { name },
      dedupe_base_prefix: `coach_invitation_accepted:${clicked.club_id}:${coachIds.join('-')}`,
    },
  );
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
      phone: formData.get('phone'),
      date_of_birth: formData.get('date_of_birth'),
      password: formData.get('password'),
      confirm: formData.get('confirm'),
    });
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? 'invalid_input';
      logStep('flow=new invalid-input', { code });
      if (code === 'full_name_too_short') return { error: 'full_name_too_short' };
      if (code === 'full_name_too_long') return { error: 'full_name_too_long' };
      if (code === 'phone_required') return { error: 'phone_missing' };
      if (code === 'phone_invalid') return { error: 'phone_invalid' };
      if (code === 'date_of_birth_invalid') return { error: 'date_of_birth_invalid' };
      if (code === 'password_too_short') return { error: 'password_too_short' };
      if (code === 'password_mismatch') return { error: 'password_mismatch' };
      return { error: 'invalid_input' };
    }

    const gate = await gateByToken(token);
    if (!gate.ok) return { error: gate.error };
    const invitation = gate.invitation;

    const admin = createSupabaseAdminClient();
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);

    // Cuenta a reclamar. Normalmente `invited_user_id` (la cuenta que creamos al
    // enviar). CINTURÓN anti-trampa (incidente): si el enlazado falló en el envío
    // (invited_user_id NULL) pero el invitado tiene sesión del magic link de una
    // cuenta NO reclamada (invite_pending) de ESTE email, reclamamos esa sesión —
    // así no queda atrapado. SEGURIDAD: solo con invite_pending + email coincidente;
    // una cuenta PREEXISTENTE (sin invite_pending) NO entra aquí → sigue el flujo
    // 'sign_in' (no se reabre el vector de secuestro de cuentas).
    let targetUid = invitation.invited_user_id;
    if (!targetUid) {
      const { data: sessData } = await supabase.auth.getUser();
      const su = sessData.user;
      // El flag vive en user_metadata (no app_metadata): mismo bucket que lee la page.
      const suPending = isInvitePending(su);
      const suEmailMatches =
        !!su?.email &&
        su.email.trim().toLowerCase() === invitation.email.trim().toLowerCase();
      if (su && suPending && suEmailMatches) {
        targetUid = su.id;
        logStep('flow=new recovered-target-from-session', { invitation_id: invitation.id });
      }
    }
    if (!targetUid) {
      // Defensivo/seguridad: sin cuenta reclamable (ni invited_user_id ni sesión no
      // reclamada) → un invitee existente debe INICIAR SESIÓN, no fijar contraseña por
      // el token (vector de secuestro). Abortamos.
      logError(
        'flow=new no-invited-user',
        new Error('acceptNewInvitee without invited_user_id nor unclaimed magic-link session'),
        { invitation_id: invitation.id },
      );
      return { error: 'auth_update_failed' };
    }

    // R-1 — pasos 1-4 (contraseña → sesión → perfil) en core: la pantalla nativa
    // tiene que hacer exactamente lo mismo, y escribirlo dos veces es lo que
    // acaba diciendo dos cosas. `targetUid` se resuelve ARRIBA, aquí, porque el
    // cinturón anti-trampa depende de la sesión del magic link de la web y en
    // nativa no hay ninguna sesión antes de esto.
    logStep('flow=new claim start', { invitation_id: invitation.id });
    const claimed = await claimInviteeAccount(
      supabase,
      admin,
      {
        targetUid,
        email: invitation.email,
        locale,
        profile: parsed.data,
      },
      (error, step, extra) =>
        logError(`flow=new ${step}`, error, {
          ...extra,
          invitation_id: invitation.id,
          user_email_masked: maskEmail(invitation.email),
        }),
    );
    if ('error' in claimed) return { error: claimed.error };
    logStep('flow=new claim ok', { invitation_id: invitation.id });

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
