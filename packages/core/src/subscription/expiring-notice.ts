/**
 * SU-6b — disparo del AVISO DE VENCIMIENTO. Solo servidor (service-role).
 *
 * Todo el criterio vive en `notify_subscription_expiring` (SU-6a): a quién se avisa, la
 * ventana de días y la clave de dedupe (una notificación por FECHA de vencimiento, no
 * por día, así que el cron puede correr a diario sin repetirse). Aquí no se decide nada.
 *
 * Canal `in_app` y solo `in_app`: la notificación aparece en novedades, no como push. Es
 * un aviso de facturación, no algo que justifique sonar en el móvil de nadie.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type AdminClient = SupabaseClient<Database>;

/** Días de antelación. 7 da margen a cambiar la tarjeta antes de perder el acceso. */
export const SUBSCRIPTION_EXPIRY_NOTICE_DAYS = 7;

export type ExpiringNoticeResult = { ok: true; notified: number } | { ok: false; raw: unknown };

export async function notifySubscriptionExpiringFromClient(
  admin: AdminClient,
  days: number = SUBSCRIPTION_EXPIRY_NOTICE_DAYS,
): Promise<ExpiringNoticeResult> {
  const { data, error } = await admin.rpc('notify_subscription_expiring', { p_days: days });
  if (error) return { ok: false, raw: error };
  return { ok: true, notified: typeof data === 'number' ? data : 0 };
}
