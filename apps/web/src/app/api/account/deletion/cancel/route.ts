/**
 * BC-3 — "Me arrepiento". Admitido en cualquier momento hasta que el job remate el
 * borrado (decisión de Jose: sin ventana más corta).
 *
 * Sin service-role en ninguna parte: la RPC corre COMO EL USUARIO y lleva `auth.uid()`
 * cableado, así que nadie puede cancelar el borrado de otro.
 *
 * Respuestas: 200 {ok} · 401 · 409 (`not_pending`) · 422 (`admin_slot_taken`) · 500.
 */

import { NextResponse } from 'next/server';
import { cancelAccountDeletionFromClient } from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await cancelAccountDeletionFromClient(auth.supabase);
  if (!res.ok) {
    const status =
      res.error === 'no_session'
        ? 401
        : res.error === 'not_pending'
          ? 409
          : res.error === 'admin_slot_taken'
            ? 422
            : 500;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
