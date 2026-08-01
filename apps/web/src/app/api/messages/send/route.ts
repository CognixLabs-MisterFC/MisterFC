/**
 * O2-5 F3 — Endpoint "enviar mensaje" para la app nativa (cierra la app de familia).
 *
 * Una sola ruta con discriminador `kind` ('direct' | 'team'): ambos flujos comparten
 * la misma superficie de auth (bearer/cookie), validación y 401; solo cambia qué
 * orquestador de core se invoca. Dos rutas serían dos handlers casi idénticos.
 *
 * Orden de seguridad (invariante):
 *   1. `resolveUserFromRequest` valida el bearer (getUser) → 401 si inválido. Cliente
 *      RLS-scoped al usuario, nunca admin.
 *   2. El INSERT (messages/team_messages) se hace con ese cliente: la RLS exige ser
 *      participante. No-participante → SELECT vacío (404 not_found) o 42501 (403); en
 *      ninguno se crea nada ni se dispara el fan-out.
 *   3. El fan-out (service-role) va DESPUÉS del insert, dentro del wrapper.
 *
 * Respuestas: 200 {ok:true, message} · 401 · 400 invalid · 403 forbidden ·
 * 404 conversation_not_found · 429 rate_limited · 500 generic.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { sendDirectMessage, sendTeamMessage } from '@/lib/send-message';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

type OutcomeError =
  | 'invalid_payload'
  | 'conversation_not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'generic';

function statusFor(error: OutcomeError): number {
  switch (error) {
    case 'invalid_payload':
      return 400;
    case 'forbidden':
      return 403;
    case 'conversation_not_found':
      return 404;
    case 'rate_limited':
      return 429;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (raw ?? {}) as {
    kind?: unknown;
    conversationId?: unknown;
    teamConversationId?: unknown;
    body?: unknown;
    locale?: unknown;
  };

  const text = typeof b.body === 'string' ? b.body : '';
  const locale =
    typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';

  // Nombre del emisor para el push, leído como el usuario (RLS: su propio perfil).
  const { data: profile } = await auth.supabase
    .from('profiles')
    .select('full_name')
    .eq('id', auth.user.id)
    .maybeSingle();
  const senderName = (profile?.full_name as string | null | undefined) ?? null;

  if (b.kind === 'direct') {
    const conversationId =
      typeof b.conversationId === 'string' ? b.conversationId : '';
    if (!conversationId) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 });
    }
    const res = await sendDirectMessage(auth.supabase, {
      conversationId,
      body: text,
      senderId: auth.user.id,
      senderName,
      locale,
    });
    if ('error' in res) {
      return NextResponse.json(
        { error: res.error },
        { status: statusFor(res.error) },
      );
    }
    return NextResponse.json({ ok: true, message: res.ok.message });
  }

  if (b.kind === 'team') {
    const teamConversationId =
      typeof b.teamConversationId === 'string' ? b.teamConversationId : '';
    if (!teamConversationId) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 });
    }
    const res = await sendTeamMessage(auth.supabase, {
      teamConversationId,
      body: text,
      senderId: auth.user.id,
      senderName,
      locale,
    });
    if ('error' in res) {
      return NextResponse.json(
        { error: res.error },
        { status: statusFor(res.error) },
      );
    }
    return NextResponse.json({ ok: true, message: res.ok.message });
  }

  return NextResponse.json({ error: 'invalid' }, { status: 400 });
}
