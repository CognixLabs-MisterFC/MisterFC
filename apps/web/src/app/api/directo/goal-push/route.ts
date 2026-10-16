/**
 * EL EMPUJÓN DEL GOL — envío inmediato de las filas de push de UN gol.
 *
 * POR QUÉ EXISTE. El aviso de gol ya nace en la base (trigger `notify_goal`, mig
 * 20261126000000): un gol apuntado desde la app nativa crea su fila de push venga de
 * donde venga. Y el drenador de cada minuto (`/api/cron/push-drain`) ya la envía. Pero
 * «hasta un minuto» no es lo mismo que «ahora», y en un directo la diferencia se nota:
 * la familia que no está en el campo quiere el aviso con el gol, no con el saque.
 *
 * Así que la app, justo después de confirmar la subida del evento, da este empujón. Es
 * la pata EAGER del diseño; el cron sigue debajo como red, y por eso esta llamada puede
 * fallar sin consecuencias: si no sale, el gol se avisa igual en el próximo minuto.
 *
 * LO QUE NO HACE, a propósito:
 *  · No decide si el gol es fresco. Eso ya está decidido dos veces: el trigger no CREA
 *    la fila de push si el gol se subió tarde (mide el reloj del partido), y
 *    `pushRowIsStale` la descarta al enviar si llevaba demasiado esperando. Repetir la
 *    regla aquí sería un tercer sitio donde se puede desincronizar.
 *  · No crea notificaciones. Si el trigger no creó nada, aquí no hay nada que mandar y
 *    la respuesta es un `scanned: 0` honesto.
 *  · No reenvía. El drenador solo mira `status='pending'`, así que llamar diez veces al
 *    mismo gol no manda diez pushes: manda los que queden pendientes, que tras el
 *    primero son cero.
 *
 * ORDEN DE SEGURIDAD (invariante de la casa, igual que `/api/spectators/invite`):
 *   1. `resolveUserFromRequest` valida el bearer → 401. El cliente que devuelve es
 *      RLS-scoped al usuario, NUNCA admin.
 *   2. El gate se comprueba COMO EL USUARIO: la fila de gol tiene que ser visible para
 *      él y haberla escrito él (`created_by`, que el trigger de 7.1 fuerza con
 *      auth.uid()). Es exactamente quien acaba de registrar el gol en el directo.
 *   3. Solo después se usa el service-role, y solo para enviar las filas de ESE gol.
 *
 * Respuestas: 200 {ok, push} · 400 invalid|not_a_goal · 401 unauthorized · 403
 * forbidden · 500 generic.
 */

import { NextResponse } from 'next/server';
import {
  createSupabaseAdminClient,
  goalDedupeLikePrefix,
  goalPushRequestDecision,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { drainPushQueue } from '@/lib/drain-push-queue';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Tope por llamada: las filas de push de un gol son los seguidores del equipo menos
 * quien lo graba. 200 sobra para cualquier equipo de la casa, y si alguno lo pasara,
 * el resto sale en el drenador del minuto siguiente — que es justo la red de abajo.
 */
const MAX_FILAS = 200;

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
  const goalRowId = (body as { goalRowId?: unknown } | null)?.goalRowId;

  // El id entra en un `like` más abajo, así que se valida la FORMA antes de tocar nada:
  // un '%' colado aquí buscaría las filas de todos los goles, no las de uno.
  if (typeof goalRowId !== 'string' || !UUID_RE.test(goalRowId)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Gate como el usuario. `maybeSingle` para que la AUSENCIA no llegue como error: con
  // el JWT del usuario y la RLS delante, una fila que no se ve y una que no existe son
  // indistinguibles desde aquí, y las dos son 403. Un error de verdad (red, permisos
  // del esquema) es otra cosa y no se disfraza de «no es tuyo».
  const { data: fila, error } = await auth.supabase
    .from('match_events')
    .select('created_by, type, metadata')
    .eq('id', goalRowId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'generic' }, { status: 500 });
  }

  // La DECISIÓN vive en core (`goalPushRequestDecision`) porque apps/web no tiene suite:
  // aquí dentro no se podría poner roja, y es la parte que decide quién puede disparar
  // un envío. El handler solo la traduce a HTTP. El predicado de «es gol» es el MISMO
  // que la cláusula WHEN del trigger, y ahora está escrito una vez.
  const outcome = (fila?.metadata as { outcome?: string } | null)?.outcome ?? null;
  const decision = goalPushRequestDecision({
    row: fila ? { created_by: fila.created_by, type: fila.type, outcome } : null,
    callerProfileId: auth.user.id,
  });
  if (decision === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (decision === 'not_a_goal') {
    return NextResponse.json({ error: 'not_a_goal' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const push = await drainPushQueue(admin, MAX_FILAS, {
    dedupePrefix: goalDedupeLikePrefix(goalRowId),
  });

  return NextResponse.json({ ok: true, push });
}
