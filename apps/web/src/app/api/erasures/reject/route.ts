/**
 * O2-11c-2 — Endpoint "RECHAZAR supresión" (dirección). RPC plana: escritura RLS
 * como el usuario, SIN service-role y SIN storage (rechazar no borra nada).
 *
 * Mismo gate que aprobar: bearer → 401; GATE admin_club-ONLY (`resolveErasureAdminClub`)
 * → un DIRECTOR obtiene 403 (mismo criterio que aprobar); RPC
 * `decide_player_erasure(rechazar)` como el usuario. No hay borrado de storage (el
 * callback no se invoca al rechazar).
 *
 * Respuestas: 200 {ok} · 401 · 403 (no admin_club) · 404/409 · 500.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { decideErasureWeb, resolveErasureAdminClub } from '@/lib/erasures';

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
  const b = (raw ?? {}) as { requestId?: unknown; reason?: unknown };
  const requestId = typeof b.requestId === 'string' ? b.requestId : '';
  const reason = typeof b.reason === 'string' ? b.reason : null;
  if (!requestId) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });

  const clubId = await resolveErasureAdminClub(auth.supabase, auth.user.id, requestId);
  if (!clubId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const res = await decideErasureWeb(auth.supabase, requestId, false, reason);
  if (!res.success) {
    const status =
      res.error === 'forbidden'
        ? 403
        : res.error === 'not_found'
          ? 404
          : res.error === 'already_decided'
            ? 409
            : 500;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
