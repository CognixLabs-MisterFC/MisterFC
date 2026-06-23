/**
 * F13.9a — Lectura del feed de novedades para el panel de Inicio.
 *
 * Reusa la tabla `notifications` de F5.7 (sin migración): las últimas N filas
 * `channel='in_app'` del usuario, más recientes primero. La RLS `notifications_
 * select_own` (`user_id = auth.uid()`) ya restringe a las del propio usuario, así
 * que el feed es rol-aware "gratis" (cada quien ve solo lo suyo); no se filtra
 * user_id en la query, igual que el badge del sidebar.
 *
 * Mostramos leídas y no leídas (status `pending`=no leído, `sent`=leído) para que
 * el feed sea un historial reciente; el panel marca visualmente las pendientes.
 * NO se marca nada como leído al leer (D2): abrir Inicio no debe vaciar el badge.
 */

import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { InAppNotificationRow } from './notifications-feed';

/** Cuántas novedades muestra el panel de Inicio. */
export const FEED_LIMIT = 6;

export async function loadNotificationFeed(
  limit: number = FEED_LIMIT,
): Promise<InAppNotificationRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('notifications')
    .select('id, type, payload, status, created_at')
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as InAppNotificationRow[];
}
