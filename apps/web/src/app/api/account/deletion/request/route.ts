/**
 * BC-3 — "Quiero borrar mi cuenta". Acepta bearer (nativa) y cookie (web).
 *
 * Orden INVIOLABLE (autentica → la RPC corre COMO EL USUARIO → el service-role solo
 * después, y solo para el efecto):
 *   1. `resolveUserFromRequest` valida la sesión → 401. Cliente RLS del usuario, NUNCA
 *      admin. No hay parámetro de target: la RPC lleva `auth.uid()` cableado, así que
 *      este endpoint no puede borrar la cuenta de otro por más que se manipule.
 *   2. RPC `request_account_deletion` como el usuario: corta su acceso en todos sus
 *      clubes, borra push/preferencias/notificaciones y crea una solicitud de supresión
 *      por cada jugador activo del que sea único tutor.
 *   3. Si NO quedan bloqueantes, se remata la anonimización aquí mismo con
 *      service-role: es el camino rápido (cuenta sin hijos que dependan de ella) y el
 *      que se graba para Apple. Si quedan, la cuenta queda en curso con fecha límite.
 *
 * Respuestas: 200 {ok, completed, blockingPlayers} · 401 · 500.
 */

import { NextResponse } from 'next/server';
import { requestAccountDeletionFromClient } from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { finalizeAccountDeletionWeb } from '@/lib/account-deletion';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let reason: string | null = null;
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body?.reason === 'string') reason = body.reason;
  } catch {
    // Cuerpo opcional: sin motivo también vale.
  }

  const res = await requestAccountDeletionFromClient(auth.supabase, reason);
  if (!res.ok) {
    const status = res.error === 'no_session' ? 401 : 500;
    return NextResponse.json({ error: res.error }, { status });
  }

  // Camino rápido: nada que espere al club → se anonimiza ya.
  if (res.blockingPlayers === 0) {
    const fin = await finalizeAccountDeletionWeb(auth.user.id);
    if (!fin.ok) {
      // La solicitud SÍ quedó registrada y el acceso YA está cortado; solo ha fallado
      // el remate. El cron de los 30 días vuelve a intentarlo.
      return NextResponse.json(
        { ok: true, completed: false, blockingPlayers: 0, warning: fin.error },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, completed: true, blockingPlayers: 0 });
  }

  return NextResponse.json({ ok: true, completed: false, blockingPlayers: res.blockingPlayers });
}
