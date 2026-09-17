/**
 * R-2 — aceptación de la cuenta propia del menor, SIN sesión.
 *
 * La app nativa no puede usar la Server Action de `/invite/{token}`: no tiene cookie ni
 * la service-role key. Este endpoint expone el MISMO flujo —el de core, extraído en
 * R-1— con el token como credencial, siguiendo el patrón de `/api/players/self-invite`.
 *
 * ES EL ENDPOINT MÁS DELICADO DEL PROYECTO: público, sin autenticar, y fija contraseñas.
 * Tres cosas lo sujetan, y ninguna es opcional:
 *
 *   1. EL GATE (`decideSelfAccept`, en core con pruebas). Solo invitaciones `self` con
 *      cuenta sin reclamar. La rama `sign_in` NO entra: atenderla sería verificar
 *      contraseñas existentes contra un endpoint sin autenticar.
 *   2. EL LÍMITE (`register_invite_accept_attempt`, migración 20261074000000). Va ANTES
 *      que nada caro y falla CERRADO.
 *   3. LO QUE YA HABÍA: el token es un uuid v4 (122 bits) y la invitación es de un solo
 *      uso con caducidad de 7 días. Esto es lo que de verdad protege; 1 y 2 son el
 *      refuerzo.
 *
 * Respuestas: 200 {access_token, refresh_token, expires_at, user_id} · 400 invalid y
 * códigos de campo · 404 not_found · 409 estados (already_accepted, expired, not_self,
 * not_claimable) y candados de la RPC · 429 rate_limited + Retry-After · 503 si el
 * contador no está disponible · 500 generic.
 */

import { NextResponse } from 'next/server';
import {
  acceptInvitationWithProfileSchema,
  acceptPendingInvitationsFromClient,
  claimInviteeAccount,
  createSupabaseAdminClient,
  decideSelfAccept,
  type SelfAcceptRefusal,
} from '@misterfc/core';
import { clientIpFrom } from '@/lib/client-ip';
import { createEphemeralSupabaseClient } from '@/lib/supabase-ephemeral';
import { loadInvitationByToken } from '@/app/[locale]/invite/[token]/invite-data';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE_RE = /^[a-z]{2}$/;

/** Estados: la petición es válida, el estado de hoy no la permite. */
const CONFLICT: ReadonlySet<string> = new Set<SelfAcceptRefusal | string>([
  'already_accepted',
  'expired',
  'not_self',
  'not_claimable',
  'consent_required',
  'account_deletion_in_progress',
  'image_decision_required',
  'image_required',
  'reserved_for_tutor',
  'wrong_email',
]);

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid', 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // El token se valida ANTES del contador porque el contador se indexa POR token: sin
  // token no hay nada que contar. Un cuerpo malformado no llega a tocar la base ni
  // GoTrue, así que lo único que cuesta es la invocación de la función, que es lo que
  // limita la propia plataforma.
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!UUID_RE.test(token)) return fail('invalid', 400);

  const admin = createSupabaseAdminClient();
  const ip = clientIpFrom(req.headers);

  // ── 1 · El límite, antes que nada caro ──────────────────────────────────
  // FALLA CERRADO: si el contador no responde no se atiende. No añade fragilidad —
  // la base ya está en el camino crítico: sin ella la RPC de aceptación tampoco iba
  // a funcionar.
  const { data: limitRows, error: limitErr } = await admin.rpc(
    'register_invite_accept_attempt',
    { p_token: token, p_ip: ip ?? undefined },
  );
  if (limitErr) return fail('unavailable', 503);

  const limit = Array.isArray(limitRows) ? limitRows[0] : limitRows;
  if (!limit) return fail('unavailable', 503);

  if (limit.decision !== 'ok') {
    // Idéntica exista o no el token: si distinguiera, el limitador sería el oráculo de
    // enumeración que viene a evitar.
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retry_after_seconds ?? 60) },
      },
    );
  }

  // ── 2 · El cuerpo ───────────────────────────────────────────────────────
  const parsed = acceptInvitationWithProfileSchema.safeParse({
    full_name: b.full_name,
    phone: b.phone,
    date_of_birth: b.date_of_birth,
    password: b.password,
    confirm: b.confirm,
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message ?? 'invalid_input';
    // `phone_required` se renombra a `phone_missing` igual que en la web: el nombre que
    // ve el cliente es el mismo por los dos caminos.
    return fail(code === 'phone_required' ? 'phone_missing' : code, 400);
  }

  // Los consentimientos de CUENTA (T&C y privacidad) SÍ se piden: MN-3 los mantiene
  // para el menor porque son los términos de SU cuenta. Los del JUGADOR —imagen,
  // médica— quedan reservados al tutor, y por eso no hay `children` ni `medical`.
  if (b.accept_terms !== true || b.accept_privacy !== true) {
    return fail('consent_required', 409);
  }

  const locale = typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';

  // ── 3 · El gate ─────────────────────────────────────────────────────────
  const invitation = await loadInvitationByToken(token);
  const gate = decideSelfAccept(invitation, Date.now());
  if ('error' in gate) {
    return fail(gate.error, gate.error === 'not_found' ? 404 : 409);
  }

  // ── 4 · El alta, la misma de la web ─────────────────────────────────────
  const supabase = createEphemeralSupabaseClient();

  const claimed = await claimInviteeAccount(supabase, admin, {
    targetUid: gate.ok.targetUid,
    email: gate.ok.email,
    locale,
    profile: parsed.data,
  });
  if ('error' in claimed) return fail(claimed.error, 500);

  const attached = await acceptPendingInvitationsFromClient(supabase, {
    token,
    accepts: { terms: true, privacy: true },
    audit: { ip, userAgent: req.headers.get('user-agent') },
  });
  if ('error' in attached) {
    return fail(attached.error, CONFLICT.has(attached.error) ? 409 : 500);
  }

  // ── 5 · La sesión, para que la app entre sin volver a pedir nada ────────
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return fail('no_session', 500);

  return NextResponse.json({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
    expires_at: sess.session.expires_at ?? null,
    user_id: claimed.ok.userId,
  });
}
