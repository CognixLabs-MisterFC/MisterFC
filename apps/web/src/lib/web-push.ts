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
import type { ChannelResult, Database, Json } from '@misterfc/core';
import { expoDataFromNotification, mergeChannelOutcomes } from '@misterfc/core';
import { sendExpoToUser } from './expo-push';

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
 * Envía SOLO por Web Push a las suscripciones del user. NO consulta el gate
 * (lo hace el caller). Devuelve `null` si el user no tiene suscripciones
 * (distinto de `{sent:0}`). Borra las suscripciones muertas (404/410).
 */
async function sendWebOnly(
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: PushPayload,
): Promise<ChannelResult> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return null;

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

  return { sent, failed_gone: failedGone, failed_other: failedOther };
}

/**
 * Envía un push a TODOS los canales del user: sus suscripciones Web Push
 * (navegador) Y sus Expo push tokens (app nativa). Respeta
 * `notification_preferences` consultando el gate UNA sola vez (mismo canal
 * 'push'); si el user lo desactivó, devuelve `skipped_user_pref=true` sin enviar
 * por ningún canal. Web+app recibe por los dos (no se desduplica).
 *
 * `dataSource` alimenta el `data` del push NATIVO (type + IDs del recurso, para
 * que la app derive la ruta): el bus pasa el `in_app_payload` (con event_id/
 * team_id/…); el cron pasa el push payload (con `deep_link`, del que se extrae el
 * resource_id si lo hay). Nunca se manda la ruta web como destino nativo.
 *
 * El caller marca la fila `notifications` según el resultado (drainer/eager).
 */
export async function sendPushToUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  notificationType: Database['public']['Enums']['notification_type'],
  payload: PushPayload,
  dataSource?: Json,
): Promise<SendPushResult> {
  configureVapid();

  // Gate UNA vez para ambos canales. null/undefined → true (opt-in por defecto).
  const { data: wantsRow } = await supabase.rpc('user_wants_notification', {
    p_user_id: userId,
    p_type: notificationType,
    p_channel: 'push',
  });
  const wants = wantsRow !== false;
  if (!wants) {
    return {
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      skipped_user_pref: true,
      skipped_no_subscriptions: false,
    };
  }

  const expoData = expoDataFromNotification(
    notificationType,
    dataSource ?? (payload as unknown as Json),
  );

  // Ambos canales en paralelo; cada uno limpia sus destinos muertos.
  const [web, expo] = await Promise.all([
    sendWebOnly(supabase, userId, payload),
    sendExpoToUser(
      supabase,
      userId,
      { title: payload.title, body: payload.body },
      expoData,
    ),
  ]);

  const merged = mergeChannelOutcomes(true, web, expo);
  return {
    sent: merged.sent,
    failed_gone: merged.failed_gone,
    failed_other: merged.failed_other,
    skipped_user_pref: merged.skipped_user_pref,
    skipped_no_subscriptions: merged.skipped_no_subscriptions,
  };
}

// Re-export del helper puro desde core (testable allí).
export { pushPayloadFromNotificationRow } from '@misterfc/core';
