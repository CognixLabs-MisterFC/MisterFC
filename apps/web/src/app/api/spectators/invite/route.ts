/**
 * O2-5 F2 — Endpoint "invitar seguidor" para la app nativa.
 *
 * La app llama con `Authorization: Bearer <access_token>` (no tiene cookie ni la
 * service-role key). Réplica EXACTA del flujo web `inviteSpectatorForPlayer`,
 * compartiendo el factor común `performSpectatorInvite`.
 *
 * Orden de seguridad (invariante):
 *   1. `resolveUserFromRequest` valida el bearer (getUser) → 401 si inválido. El
 *      cliente resultante es RLS-scoped al usuario, NUNCA admin.
 *   2. `invite_spectator` (RPC SECURITY DEFINER) se llama COMO EL USUARIO; su gate
 *      tutor/self corre ANTES del INSERT → no-tutor no crea invitación (→ 403).
 *   3. Solo tras crear la invitación se usa el ADMIN client para el email. El
 *      service-role jamás actúa antes del gate.
 *
 * Respuestas: 200 {status:'ok'|'existing', email} · 401 unauthorized · 400
 * invalid|email_invalid · 403 forbidden (no-tutor) · 500 generic. `existing` marca
 * el caso "email ya registrado" (se reenvió por reset), para que la app lo muestre.
 *
 * No hay CORS: la app nativa no es un navegador (no dispara preflight). El único
 * requisito de acceso es un bearer válido; sin él, 401.
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, inviteSpectatorSchema } from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { performSpectatorInvite } from '@/lib/invite-spectator';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (body ?? {}) as {
    playerId?: unknown;
    email?: unknown;
    locale?: unknown;
  };

  const playerId = typeof b.playerId === 'string' ? b.playerId : '';
  if (!playerId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const parsedEmail = inviteSpectatorSchema.safeParse({ email: b.email });
  if (!parsedEmail.success) {
    return NextResponse.json({ error: 'email_invalid' }, { status: 400 });
  }

  const locale =
    typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const linkBase = `${proto}://${host}/${locale}/invite`;

  // El gate vive dentro del RPC (invocado por auth.supabase = cliente del usuario);
  // el admin solo se usa para el email, DESPUÉS de crear la invitación.
  const admin = createSupabaseAdminClient();
  const res = await performSpectatorInvite(auth.supabase, admin, {
    playerId,
    email: parsedEmail.data.email,
    linkBase,
  });

  if ('error' in res) {
    const status =
      res.error === 'forbidden' ? 403 : res.error === 'email_invalid' ? 400 : 500;
    return NextResponse.json({ error: res.error }, { status });
  }

  return NextResponse.json({
    status: res.ok.existing ? 'existing' : 'ok',
    email: res.ok.email,
  });
}
