/**
 * O2-11c-1 — Endpoint "marcar festivo" para la app nativa (dirección). Trozo con
 * SERVICE-ROLE (fan-out de cancelaciones).
 *
 * Orden de seguridad (invariante F1/F3/7b-2/10b-1b):
 *   1. `resolveUserFromRequest` valida el bearer → 401 si inválido. Cliente
 *      RLS-scoped al usuario, NUNCA admin.
 *   2. La RPC `mark_holiday` se llama COMO ESE USUARIO: su gate
 *      `user_is_admin_or_director(p_club_id)` rechaza a quien no sea admin/director
 *      → 'forbidden' → 403 y el FAN-OUT NO se dispara.
 *   3. El fan-out (service-role: coaches/familias, campana + push blindado) va
 *      DESPUÉS de la RPC, dentro de `markHolidayWeb` (core + inyección notify-bus).
 *
 * Respuestas: 200 {ok, holidayId} · 401 · 400 invalid/estado · 403 forbidden · 500.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { markHolidayWeb } from '@/lib/holidays';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (raw ?? {}) as { clubId?: unknown; date?: unknown; reason?: unknown };
  const clubId = typeof b.clubId === 'string' ? b.clubId : '';
  const date = typeof b.date === 'string' ? b.date : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!clubId || !DATE_RE.test(date) || reason.length === 0) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const res = await markHolidayWeb(auth.supabase, clubId, date, reason);
  if (!res.success) {
    const status = res.error === 'forbidden' ? 403 : res.error === 'db' ? 500 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true, holidayId: res.holidayId });
}
