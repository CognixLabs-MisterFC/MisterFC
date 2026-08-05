/**
 * O2-11c-1 — Endpoint "desmarcar festivo" (dirección). Mismo invariante que
 * /api/holidays/mark: bearer → 401; RPC `unmark_holiday` como el usuario (gate
 * admin/director dentro → 403); fan-out de reactivación (service-role) DESPUÉS,
 * dentro de `unmarkHolidayWeb`.
 *
 * Respuestas: 200 {ok, holidayId} · 401 · 400 invalid/estado · 403 forbidden · 500.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { unmarkHolidayWeb } from '@/lib/holidays';

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
  const b = (raw ?? {}) as { holidayId?: unknown };
  const holidayId = typeof b.holidayId === 'string' ? b.holidayId : '';
  if (!holidayId) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const res = await unmarkHolidayWeb(auth.supabase, holidayId);
  if (!res.success) {
    const status = res.error === 'forbidden' ? 403 : res.error === 'db' ? 500 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true, holidayId: res.holidayId });
}
