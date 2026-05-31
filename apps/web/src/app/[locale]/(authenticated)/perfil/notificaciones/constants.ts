import type { Database } from '@misterfc/core';

type NotificationType = Database['public']['Enums']['notification_type'];
type NotificationChannel = Database['public']['Enums']['notification_channel'];

/**
 * F5.6 — orden y subconjunto de tipos visibles en la matrix.
 *
 * `match_callup_reminder` y `attendance_pending_reminder` existen desde F4
 * pero solo aplican a coaches → si quieres ocultárselos a jugadores, hazlo
 * en la página, no aquí.
 *
 * NOTA: este archivo es módulo "normal" (no 'use server'). Las constantes
 * no pueden vivir junto a las server actions porque Next.js prohíbe
 * exports no-async en archivos 'use server'.
 */
export const NOTIFICATION_TYPES_LIST: ReadonlyArray<NotificationType> = [
  'new_message',
  'new_announcement',
  'callup_published',
  'match_callup_reminder',
  'training_reminder',
  'attendance_pending_reminder',
];

export const NOTIFICATION_CHANNELS_LIST: ReadonlyArray<NotificationChannel> = [
  'in_app',
  'push',
  'email',
];
