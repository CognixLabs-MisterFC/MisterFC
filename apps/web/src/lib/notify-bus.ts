/**
 * F5.7 — Bus interno de notificaciones.
 *
 * Patrón único para emitir una notificación lógica desde un server action:
 *
 *   await emitNotification({ user_id, type, in_app_payload, push_payload, dedupe_key })
 *
 * Hace dos cosas con una única transacción aparente:
 *   1. INSERT en `notifications` con channel='in_app' (campana).
 *   2. INSERT en `notifications` con channel='push' (cola de envío).
 *      Si el user opted-out del tipo por push (notification_preferences),
 *      la fila va igualmente y se marca `status='skipped'` para auditoría.
 *
 * Luego intenta envío "eager": `sendPushToUser(...)`. Si funciona, marca la
 * fila push como `sent`. Si falla, la fila queda `pending` para que el
 * drainer del cron la reintente.
 *
 * Idempotente: UNIQUE(`dedupe_key`) evita duplicados. Si llamamos dos veces
 * para el mismo lookup key, las inserciones se ignoran y el segundo eager
 * send no se intenta.
 *
 * IMPORTANTE: solo se usa desde server actions / route handlers — necesita
 * el service-role client (bypass RLS para insertar en `notifications`).
 */

import * as Sentry from '@sentry/nextjs';
import { createSupabaseAdminClient, type Json } from '@misterfc/core';
import type { Database } from '@misterfc/core';
import {
  sendPushToUser,
  type PushPayload,
} from './web-push';

type NotificationType = Database['public']['Enums']['notification_type'];

export type EmitNotificationInput = {
  user_id: string;
  type: NotificationType;
  /** Payload almacenado en la fila `in_app` — la campana lo consume. */
  in_app_payload: Json;
  /** Payload de la notificación push (title, body, deep_link, tag). */
  push_payload: PushPayload;
  /** Base estable; se le concatena ':in_app' y ':push' para las dos filas. */
  dedupe_base: string;
};

export type EmitResult = {
  in_app_inserted: boolean;
  push_inserted: boolean;
  eager_sent: number;
  eager_failed_gone: number;
  eager_failed_other: number;
  skipped_user_pref: boolean;
};

/**
 * Helper interno: parses dedupe_base + channel suffix.
 */
function dedupe(base: string, channel: 'in_app' | 'push'): string {
  return `${base}:${channel}`;
}

export async function emitNotification(
  input: EmitNotificationInput,
): Promise<EmitResult> {
  const supabase = createSupabaseAdminClient();

  // 1. Insertar campana (in_app). ignoreDuplicates=true: si ya existe la fila,
  //    no la duplicamos ni lanzamos error.
  const { data: inAppRows, error: inAppErr } = await supabase
    .from('notifications')
    .upsert(
      {
        user_id: input.user_id,
        type: input.type,
        channel: 'in_app',
        payload: input.in_app_payload,
        dedupe_key: dedupe(input.dedupe_base, 'in_app'),
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('id');
  // D-3 — la notificación NO debe romper la acción del usuario, pero un fallo de
  // INSERT no puede perderse en silencio: lo reportamos y seguimos.
  if (inAppErr) {
    Sentry.captureException(inAppErr, {
      tags: { feature: 'notifications', step: 'emit_in_app' },
    });
  }
  const inAppInserted = Boolean(inAppRows && inAppRows.length > 0);

  // 2. Insertar push.
  const { data: pushRows, error: pushErr } = await supabase
    .from('notifications')
    .upsert(
      {
        user_id: input.user_id,
        type: input.type,
        channel: 'push',
        payload: input.push_payload as unknown as Json,
        dedupe_key: dedupe(input.dedupe_base, 'push'),
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('id');
  if (pushErr) {
    Sentry.captureException(pushErr, {
      tags: { feature: 'notifications', step: 'emit_push' },
    });
  }
  const insertedPushRow = pushRows?.[0];
  const pushInserted = Boolean(insertedPushRow);

  // Si la fila push no se insertó (ya existía o no se devolvió), no eager-send.
  if (!insertedPushRow) {
    return {
      in_app_inserted: inAppInserted,
      push_inserted: false,
      eager_sent: 0,
      eager_failed_gone: 0,
      eager_failed_other: 0,
      skipped_user_pref: false,
    };
  }

  const pushRowId = insertedPushRow.id;

  // 3. Eager send. sendPushToUser respeta user_wants_notification.
  let eagerSent = 0;
  let eagerFailedGone = 0;
  let eagerFailedOther = 0;
  let skippedPref = false;

  try {
    const r = await sendPushToUser(
      supabase,
      input.user_id,
      input.type,
      input.push_payload,
    );
    eagerSent = r.sent;
    eagerFailedGone = r.failed_gone;
    eagerFailedOther = r.failed_other;
    skippedPref = r.skipped_user_pref;

    // Actualiza la fila push según el outcome:
    //   - sent > 0           → status='sent', sent_at=now()
    //   - skipped_user_pref  → status='skipped'
    //   - no_subscriptions   → queda pending (el user todavía no se ha suscrito)
    //   - failed_*           → queda pending para el cron retry
    if (r.skipped_user_pref) {
      await supabase
        .from('notifications')
        .update({ status: 'skipped', sent_at: new Date().toISOString() })
        .eq('id', pushRowId);
    } else if (r.sent > 0) {
      await supabase
        .from('notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', pushRowId);
    }
  } catch {
    // Eager send no debe romper el server action — el cron lo retoma.
  }

  return {
    in_app_inserted: inAppInserted,
    push_inserted: pushInserted,
    eager_sent: eagerSent,
    eager_failed_gone: eagerFailedGone,
    eager_failed_other: eagerFailedOther,
    skipped_user_pref: skippedPref,
  };
}

/**
 * Variante para múltiples destinatarios. Llama a `emitNotification` por
 * cada user_id en paralelo. La función NUNCA lanza — si un envío falla,
 * sigue con los demás (logs internos via Sentry en el caller).
 */
export async function emitNotificationFanOut(
  recipients: ReadonlyArray<{ user_id: string; dedupe_base_suffix?: string }>,
  base: Omit<EmitNotificationInput, 'user_id' | 'dedupe_base'> & {
    dedupe_base_prefix: string;
  },
): Promise<EmitResult[]> {
  return Promise.all(
    recipients.map((r) =>
      emitNotification({
        user_id: r.user_id,
        type: base.type,
        in_app_payload: base.in_app_payload,
        push_payload: base.push_payload,
        dedupe_base: `${base.dedupe_base_prefix}:${r.dedupe_base_suffix ?? r.user_id}`,
      }).catch((e) => {
        // D-3 — el fan-out NUNCA lanza (un destinatario roto no frena a los
        // demás), pero el fallo se reporta en vez de perderse.
        Sentry.captureException(e, {
          tags: { feature: 'notifications', step: 'emit_fan_out' },
        });
        return {
          in_app_inserted: false,
          push_inserted: false,
          eager_sent: 0,
          eager_failed_gone: 0,
          eager_failed_other: 0,
          skipped_user_pref: false,
        };
      }),
    ),
  );
}
