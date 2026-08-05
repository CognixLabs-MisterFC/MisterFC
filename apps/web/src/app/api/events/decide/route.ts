/**
 * O2-11c-1 — Endpoint "aprobar/rechazar entreno en festivo" (dirección). Mismo
 * invariante: bearer → 401; RPC `decide_event_approval` como el usuario (gate
 * admin/director dentro → 403); aviso al creador (service-role fan-out) DESPUÉS,
 * dentro de `decideEventApprovalWeb`. El rechazo exige motivo (la RPC lo valida →
 * 'reason_required' → 400).
 *
 * Respuestas: 200 {ok, status} · 401 · 400 invalid/estado · 403 forbidden · 500.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { decideEventApprovalWeb } from '@/lib/holidays';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (raw ?? {}) as { eventId?: unknown; approve?: unknown; reason?: unknown };
  const eventId = typeof b.eventId === 'string' ? b.eventId : '';
  if (!eventId || typeof b.approve !== 'boolean') {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const reason = typeof b.reason === 'string' ? b.reason : null;

  const res = await decideEventApprovalWeb(auth.supabase, eventId, b.approve, reason);
  if (!res.success) {
    const status = res.error === 'forbidden' ? 403 : res.error === 'db' ? 500 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true, status: res.status });
}
