/**
 * F5.7 — Lógica pura del drainer de push.
 *
 * El cron y los server actions comparten estas funciones:
 *   - `pushPayloadFromNotificationRow`: extrae title/body/deep_link/tag de
 *     una fila `notifications.payload` (jsonb) con shape conocido.
 *   - `decideNotificationOutcome`: dada la salida de `web-push send`,
 *     devuelve qué status final escribir en la fila.
 *
 * Aisladas aquí para que sean testables con vitest sin Supabase ni red.
 */

import type { Database, Json } from '../supabase/types';

type NotificationType = Database['public']['Enums']['notification_type'];

export type PushPayload = {
  title: string;
  body: string;
  deep_link?: string;
  tag?: string;
};

/**
 * Saca el payload final de la fila. Si faltan campos, usa defaults
 * razonables por tipo (p.ej. title 'Mensaje nuevo' para 'new_message').
 */
export function pushPayloadFromNotificationRow(row: {
  payload: Json | null | undefined;
  type: NotificationType;
}): PushPayload {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  return {
    title:
      typeof p.title === 'string' ? p.title : defaultTitleForType(row.type),
    body: typeof p.body === 'string' ? p.body : '',
    deep_link: typeof p.deep_link === 'string' ? p.deep_link : undefined,
    tag: typeof p.tag === 'string' ? p.tag : row.type,
  };
}

function defaultTitleForType(type: NotificationType): string {
  switch (type) {
    case 'new_message':
      return 'Mensaje nuevo';
    case 'new_announcement':
      return 'Nuevo anuncio';
    case 'callup_published':
      return 'Convocatoria publicada';
    case 'match_callup_reminder':
      return 'Recordatorio de convocatoria';
    case 'attendance_pending_reminder':
      return 'Asistencia pendiente';
    case 'training_reminder':
      return 'Recordatorio de entrenamiento';
    default:
      return 'MisterFC';
  }
}

export type SendOutcome = {
  sent: number;
  failed_gone: number;
  failed_other: number;
  skipped_user_pref: boolean;
  skipped_no_subscriptions: boolean;
};

export type NotificationFinalStatus =
  | { status: 'sent'; mark_sent_at: true }
  | { status: 'skipped'; mark_sent_at: true }
  | { status: 'failed'; mark_sent_at: true }
  | { status: 'pending'; mark_sent_at: false };

/**
 * Decide cómo marcar la fila `notifications` tras un intento de envío.
 *
 *   - sent > 0 (al menos un dispositivo recibió) → status='sent'.
 *   - skipped_user_pref (opt-out)                → status='skipped'.
 *   - sin subs y nada enviado                    → 'pending' (espera a que
 *                                                  el user se suscriba).
 *   - solo errores 404/410 (todos los endpoints muertos) → 'failed'.
 *   - otros errores                              → 'pending' (retry).
 */
export function decideNotificationOutcome(
  out: SendOutcome,
): NotificationFinalStatus {
  if (out.sent > 0) {
    return { status: 'sent', mark_sent_at: true };
  }
  if (out.skipped_user_pref) {
    return { status: 'skipped', mark_sent_at: true };
  }
  if (out.skipped_no_subscriptions) {
    return { status: 'pending', mark_sent_at: false };
  }
  // All-gone case: hubo intentos pero todos fueron 404/410.
  if (out.failed_gone > 0 && out.failed_other === 0) {
    return { status: 'failed', mark_sent_at: true };
  }
  // Mezcla o solo otros errores → reintento por cron.
  return { status: 'pending', mark_sent_at: false };
}
