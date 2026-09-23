/**
 * Los RECIBOS de Expo Push. La mitad que faltaba.
 *
 * Al enviar, Expo devuelve un TICKET. Un ticket `ok` solo dice que Expo cogió el
 * mensaje: si FCM lo rechaza —lo normal cuando alguien reinstala la app— el error
 * aparece en el RECIBO, que se pide después por `ticket_id`.
 *
 * Nadie los pedía. Medido en producción el 2026-09-22: los 7 tokens de la base
 * devolvían ticket `ok` y recibo `DeviceNotRegistered`. Las filas de
 * `notifications` llevaban semanas marcándose `sent` sin que llegara una sola
 * notificación al teléfono, y la limpieza de tokens muertos —que solo miraba
 * tickets, donde ese error no aparece jamás— no se ejecutó nunca.
 *
 * Este cron cierra el circuito:
 *   · pide los recibos de la cola (`expo_push_tickets`);
 *   · borra de `expo_push_tokens` los que FCM da por muertos;
 *   · corrige a `failed` las notificaciones cuyo envío falló DE VERDAD;
 *   · saca de la cola los tickets ya resueltos.
 *
 * Frecuencia: CADA HORA. Expo guarda los recibos 24 h, así que hay margen de sobra;
 * lo que no se resuelva en un día se descarta por antigüedad y la cola no crece.
 *
 * Un token muerto NO marca la notificación como fallida, y es deliberado: el aviso
 * salió bien, el dispositivo ya no está. Marcarla fallida haría que el drenador la
 * reintentara contra un token que acabamos de borrar, para siempre.
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}`, el mismo secreto de proyecto
 * que los demás crons. Sin secreto configurado responde 401 — falla CERRADO.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { Expo } from 'expo-server-sdk';
import {
  createSupabaseAdminClient,
  sweepExpoReceipts,
  type PendingTicket,
} from '@misterfc/core';

export const runtime = 'nodejs';

/** Tope por pasada. Expo acepta 1000 ids por petición; esto son 10 peticiones. */
const MAX_TICKETS_PER_RUN = 10_000;

/** Expo guarda los recibos 24 h. Lo que pase de ahí no se va a resolver nunca. */
const TICKET_MAX_AGE_HOURS = 24;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - TICKET_MAX_AGE_HOURS * 3_600_000).toISOString();

  // 1) Caducados: fuera de la cola sin preguntar. Expo ya no tiene su recibo.
  const { error: purgeErr, count: expired } = await supabase
    .from('expo_push_tickets')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (purgeErr) {
    Sentry.captureException(purgeErr, {
      tags: { feature: 'notifications', step: 'receipts_purge' },
    });
  }

  // 2) La cola viva, los más antiguos primero.
  const { data: rows, error: readErr } = await supabase
    .from('expo_push_tickets')
    .select('ticket_id, token, notification_id')
    .order('created_at', { ascending: true })
    .limit(MAX_TICKETS_PER_RUN);
  if (readErr) {
    Sentry.captureException(readErr, {
      tags: { feature: 'notifications', step: 'receipts_read' },
    });
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }

  const pending: PendingTicket[] = (rows ?? []).map((r) => ({
    ticketId: r.ticket_id,
    token: r.token,
    notificationId: r.notification_id,
  }));
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, expired: expired ?? 0, checked: 0 });
  }

  // 3) Los recibos, por tandas del tamaño que marca el propio SDK.
  const expo = new Expo();
  const receipts: Record<string, unknown> = {};
  for (const chunk of expo.chunkPushNotificationReceiptIds(pending.map((p) => p.ticketId))) {
    try {
      Object.assign(receipts, await expo.getPushNotificationReceiptsAsync(chunk));
    } catch (err) {
      // Una tanda que revienta NO se resuelve: sus tickets se quedan en la cola y
      // se vuelven a pedir la hora que viene. Darlos por entregados sería repetir
      // exactamente la mentira que este cron arregla.
      Sentry.captureException(err, {
        tags: { feature: 'notifications', step: 'receipts_fetch' },
        extra: { chunk_size: chunk.length },
      });
    }
  }

  const sweep = sweepExpoReceipts(pending, receipts);

  // 4) Tokens muertos: fuera. Esto es lo que no se hacía nunca.
  if (sweep.dead_tokens.length > 0) {
    const { error } = await supabase
      .from('expo_push_tokens')
      .delete()
      .in('token', sweep.dead_tokens);
    if (error) {
      Sentry.captureException(error, {
        tags: { feature: 'notifications', step: 'receipts_delete_tokens' },
      });
    }
  }

  // 5) Las que fallaron de verdad vuelven a `pending`: el drenador las reintentará.
  if (sweep.failed_notification_ids.length > 0) {
    const { error } = await supabase
      .from('notifications')
      .update({ status: 'pending', sent_at: null })
      .in('id', sweep.failed_notification_ids)
      .eq('channel', 'push');
    if (error) {
      Sentry.captureException(error, {
        tags: { feature: 'notifications', step: 'receipts_reopen' },
      });
    }
  }

  // 6) Resueltos fuera de la cola. Los no resueltos se quedan.
  if (sweep.resolved_ticket_ids.length > 0) {
    const { error } = await supabase
      .from('expo_push_tickets')
      .delete()
      .in('ticket_id', sweep.resolved_ticket_ids);
    if (error) {
      Sentry.captureException(error, {
        tags: { feature: 'notifications', step: 'receipts_dequeue' },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    expired: expired ?? 0,
    checked: pending.length,
    delivered: sweep.delivered.length,
    dead_tokens: sweep.dead_tokens.length,
    reopened: sweep.failed_notification_ids.length,
    still_waiting: sweep.unresolved_ticket_ids.length,
  });
}
