/**
 * MN-5 — Endpoint "invitar a mi hijo a tener cuenta propia" para la app nativa.
 *
 * La app llama con `Authorization: Bearer <access_token>` (no tiene cookie ni la
 * service-role key). Réplica EXACTA del flujo web `inviteSelfForPlayer`,
 * compartiendo el factor común `performSelfInvite`.
 *
 * Orden de seguridad (invariante, el mismo de /api/spectators/invite):
 *   1. `resolveUserFromRequest` valida el bearer (getUser) → 401 si inválido. El
 *      cliente resultante es RLS-scoped al usuario, NUNCA admin.
 *   2. `invite_player_self` (RPC SECURITY DEFINER) se llama COMO EL USUARIO; sus
 *      gates corren ANTES del INSERT → quien no es tutor no crea invitación (→ 403).
 *   3. Solo tras crear la invitación se usa el ADMIN client para el email.
 *
 * Respuestas: 200 {status:'ok'|'existing', email} · 401 unauthorized · 400
 * invalid|email_invalid · 403 forbidden · 409 para los gates de estado
 * (already_linked, email_relation_conflict, consents_required, no_active_season,
 * erased) · 500 generic. El 409 los agrupa porque los cinco significan lo mismo para
 * el cliente: la petición es legítima pero el estado de hoy no la permite, y cada uno
 * tiene su propio texto en la app.
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, inviteSpectatorSchema,
  inviteLinkBase,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { performSelfInvite } from '@/lib/invite-self';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

/** Gates de estado: la petición es válida, el estado no la permite. */
const CONFLICT = new Set([
  'already_linked',
  'email_relation_conflict',
  'consents_required',
  'no_active_season',
  'erased',
  // RC-A. Es un gate de estado como los de arriba —la peticion es valida, el estado de
  // quien invita no la permite—, asi que sale 409 y no 400.
  'account_deletion_pending',
]);

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
  const b = (body ?? {}) as { playerId?: unknown; email?: unknown; locale?: unknown };

  const playerId = typeof b.playerId === 'string' ? b.playerId : '';
  if (!playerId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Mismo schema que el seguidor: solo email, y el jugador va por parámetro. La
  // relación no viaja NUNCA desde el cliente — la pone la RPC en 'self'.
  const parsedEmail = inviteSpectatorSchema.safeParse({ email: b.email });
  if (!parsedEmail.success) {
    return NextResponse.json({ error: 'email_invalid' }, { status: 400 });
  }

  const locale =
    typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';
  // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const linkBase = inviteLinkBase(locale);

  const admin = createSupabaseAdminClient();
  const res = await performSelfInvite(auth.supabase, admin, {
    playerId,
    email: parsedEmail.data.email,
    linkBase,
    locale,
  });

  if ('error' in res) {
    const status =
      res.error === 'forbidden'
        ? 403
        : res.error === 'email_invalid'
          ? 400
          : CONFLICT.has(res.error)
            ? 409
            : 500;
    return NextResponse.json({ error: res.error }, { status });
  }

  return NextResponse.json({
    status: res.ok.existing ? 'existing' : 'ok',
    email: res.ok.email,
  });
}
