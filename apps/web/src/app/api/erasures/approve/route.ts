/**
 * O2-11c-2 — Endpoint "APROBAR supresión" (dirección). La acción MÁS IRREVERSIBLE:
 * borra datos RGPD de un menor. Trozo con SERVICE-ROLE (borrado de Storage).
 *
 * Orden INVIOLABLE (bearer autentica → gate autoriza → RPC borra → storage después):
 *   1. `resolveUserFromRequest` valida el bearer → 401. Cliente RLS del usuario,
 *      NUNCA admin.
 *   2. GATE admin_club-ONLY de la app (`resolveErasureAdminClub`): deriva el club de
 *      la solicitud y exige rol `admin_club` en ese club → un DIRECTOR obtiene 403
 *      (la RPC lo admitiría, pero la app NO relaja el gate). Punto de seguridad #1.
 *   3. RPC `decide_player_erasure(aprobar)` COMO EL USUARIO (borra foto/médica,
 *      anonimiza, marca erased_at) y devuelve la ruta de la foto.
 *   4. Borrado del OBJETO de Storage con service-role, DESPUÉS de la RPC (best-effort:
 *      si falla no revierte, se logea). Todo dentro de `decideErasureWeb`.
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
  const b = (raw ?? {}) as { requestId?: unknown };
  const requestId = typeof b.requestId === 'string' ? b.requestId : '';
  if (!requestId) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });

  // GATE admin_club-ONLY (rechaza director) ANTES de la RPC y de cualquier service-role.
  const clubId = await resolveErasureAdminClub(auth.supabase, auth.user.id, requestId);
  if (!clubId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const res = await decideErasureWeb(auth.supabase, requestId, true, null);
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
