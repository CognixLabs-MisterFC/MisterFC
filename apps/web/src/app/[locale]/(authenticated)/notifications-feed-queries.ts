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

/** Tamaño de página de /novedades (patrón F2.10, igual que otras listas). */
export const NOVEDADES_PAGE_SIZE = 20;

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

/**
 * F13.9b — página completa de novedades, paginada server-side (.range() + count
 * exacto, patrón F2.10). La RLS select-own filtra por usuario.
 */
export async function loadNotificationsPage(
  page: number,
): Promise<{ rows: InAppNotificationRow[]; total: number }> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const from = (page - 1) * NOVEDADES_PAGE_SIZE;
  const to = from + NOVEDADES_PAGE_SIZE - 1;
  const { data, count } = await supabase
    .from('notifications')
    .select('id, type, payload, status, created_at', { count: 'exact' })
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false })
    .range(from, to);

  return { rows: (data ?? []) as InAppNotificationRow[], total: count ?? 0 };
}

/** F13.9b — nº de novedades NO leídas (in_app pending) del usuario. Decide si
 *  mostrar el botón "marcar todas" en el panel y la página. */
export async function countUnreadNotifications(): Promise<number> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'in_app')
    .eq('status', 'pending');

  return count ?? 0;
}
