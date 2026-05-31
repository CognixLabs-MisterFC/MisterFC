/**
 * F5 Lote B — Helper de envío push (servidor).
 *
 * - Configura VAPID una sola vez por proceso (idempotente).
 * - `sendPushToUser(user_id, payload)`: consulta `push_subscriptions`,
 *   verifica `user_wants_notification(user_id, type, 'push')`, envía a
 *   cada endpoint. Errores 404/410 → borra la subscription muerta.
 * - Devuelve métricas `{ sent, failed_gone, failed_other, skipped }` para
 *   que el caller (cron drainer o server action eager) pueda loggear /
 *   actualizar el row de `notifications` con `status`.
 *
 * NO se importa desde código cliente: usa `web-push` (Node) y service
 * role del cliente Supabase. Solo Server Actions / Route Handlers /
 * `/api/cron/*` deben llamarlo.
 */

import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@misterfc/core';

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@misterfc.app';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys missing — NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY required');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Path relativo dentro del app, p.ej. `/es/mensajes/<uuid>`. */
  deep_link?: string;
  /** Identificador opcional para colapsar notificaciones (mismo tag = reemplaza). */
  tag?: string;
};

export type SendPushResult = {
  sent: number;
  failed_gone: number;
  failed_other: number;
  skipped_user_pref: boolean;
  skipped_no_subscriptions: boolean;
};

/**
 * Envía un push a TODOS los dispositivos del user (puede tener móvil +
 * desktop + iPad). Respeta `notification_preferences` — si el user
 * desactivó este tipo por canal push, devuelve `skipped_user_pref=true`
 * sin enviar.
 *
 * El caller decide qué hacer con el resultado: el drainer marca la fila
 * de `notifications` como `sent`/`skipped`/`failed`. El eager send en
 * server actions puede ignorarlo si la cola lo recogerá.
 */
export async function sendPushToUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  notificationType: Database['public']['Enums']['notification_type'],
  payload: PushPayload,
): Promise<SendPushResult> {
  configureVapid();

  // ¿Quiere el user este tipo por canal push?
  const { data: wantsRow } = await supabase.rpc('user_wants_notification', {
    p_user_id: userId,
    p_type: notificationType,
    p_channel: 'push',
  });
  const wants = wantsRow !== false; // null/undefined → true (default opt-in)
  if (!wants) {
    return {
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      skipped_user_pref: true,
      skipped_no_subscriptions: false,
    };
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) {
    return {
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      skipped_user_pref: false,
      skipped_no_subscriptions: true,
    };
  }

  let sent = 0;
  let failedGone = 0;
  let failedOther = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 }, // 24h
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Endpoint muerto — borra la subscription. Service-role lo permite.
          failedGone += 1;
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          failedOther += 1;
        }
      }
    }),
  );

  return {
    sent,
    failed_gone: failedGone,
    failed_other: failedOther,
    skipped_user_pref: false,
    skipped_no_subscriptions: false,
  };
}

// Re-export del helper puro desde core (testable allí).
export { pushPayloadFromNotificationRow } from '@misterfc/core';
