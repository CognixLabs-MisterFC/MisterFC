import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';

/**
 * O2-5 B1 — Feed de novedades in_app (lectura + marcado), extraído de
 * `apps/web/.../notifications-feed-queries.ts` y `lib/notifications-actions.ts`.
 * La RLS `notifications_select_own` restringe al propio usuario, así que el feed
 * es por-usuario sin filtrar `user_id` en el select (igual que el badge).
 */

type DbClient = SupabaseClient<Database>;
type NotificationType = Database['public']['Enums']['notification_type'];

/** Fila in_app tal como la lee el feed (subset de `notifications`). */
export type NotificationFeedRow = {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  created_at: string;
};

/** Cuántas novedades muestra el panel de Inicio. */
export const FEED_LIMIT = 6;
/** Tamaño de página de /novedades (pestaña "Todas", histórico paginado). */
export const NOVEDADES_PAGE_SIZE = 20;
/** Nº de novedades SIN LEER que muestra la pestaña por defecto de /novedades. */
export const UNREAD_FEED_LIMIT = 10;

/**
 * Tipos in_app que NO son "novedades" y no deben aparecer en el feed ni contar
 * como no leídos: el gol pertenece al DIRECTO, no al feed (QA en dispositivo).
 * OJO: solo afecta a la LECTURA. La generación de la fila y la cola de push
 * (channel='push', `pushPayloadFromNotificationRow`) quedan intactas, así que el
 * push de gol a seguidores sigue siendo posible.
 */
const FEED_HIDDEN_TYPE: NotificationType = 'goal';

export async function getNotificationFeedFromClient(
  supabase: DbClient,
  limit: number = FEED_LIMIT
): Promise<NotificationFeedRow[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, type, payload, status, created_at')
    .eq('channel', 'in_app')
    .neq('type', FEED_HIDDEN_TYPE)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationFeedRow[];
}

/**
 * Novedades SIN LEER (status='pending'), más recientes primero, hasta `limit`.
 * Es lo que muestra la pestaña por defecto de /novedades: al marcar una como
 * leída (pending→sent) sale de este listado. Excluye el mismo tipo oculto que el
 * feed y el contador (`goal`), así el listado y el badge son coherentes.
 */
export async function getUnreadNotificationsFeedFromClient(
  supabase: DbClient,
  limit: number = UNREAD_FEED_LIMIT
): Promise<NotificationFeedRow[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, type, payload, status, created_at')
    .eq('channel', 'in_app')
    .neq('type', FEED_HIDDEN_TYPE)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationFeedRow[];
}

export async function getNotificationsPageFromClient(
  supabase: DbClient,
  page: number,
  pageSize: number = NOVEDADES_PAGE_SIZE
): Promise<{ rows: NotificationFeedRow[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await supabase
    .from('notifications')
    .select('id, type, payload, status, created_at', { count: 'exact' })
    .eq('channel', 'in_app')
    .neq('type', FEED_HIDDEN_TYPE)
    .order('created_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as NotificationFeedRow[], total: count ?? 0 };
}

export async function getUnreadNotificationsCountFromClient(
  supabase: DbClient
): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'in_app')
    .neq('type', FEED_HIDDEN_TYPE)
    .eq('status', 'pending');
  return count ?? 0;
}

/** Marca leídas (pending→sent) las in_app del usuario de ciertos tipos. */
export async function markNotificationsReadFromClient(
  supabase: DbClient,
  types: NotificationType[]
): Promise<{ marked: number }> {
  if (types.length === 0) return { marked: 0 };
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { marked: 0 };
  const { data } = await supabase
    .from('notifications')
    .update({ status: 'sent' })
    .eq('user_id', user.id)
    .eq('channel', 'in_app')
    .eq('status', 'pending')
    .in('type', types)
    .select('id');
  return { marked: data?.length ?? 0 };
}

/** Marca UNA in_app como leída por id (al abrirla desde el feed). */
export async function markNotificationReadFromClient(
  supabase: DbClient,
  id: string
): Promise<{ marked: number }> {
  if (!id) return { marked: 0 };
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { marked: 0 };
  const { data } = await supabase
    .from('notifications')
    .update({ status: 'sent' })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('channel', 'in_app')
    .eq('status', 'pending')
    .select('id');
  return { marked: data?.length ?? 0 };
}

/** "Marcar todas": todas las in_app pendientes del usuario a sent. */
export async function markAllNotificationsReadFromClient(
  supabase: DbClient
): Promise<{ marked: number }> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { marked: 0 };
  const { data } = await supabase
    .from('notifications')
    .update({ status: 'sent' })
    .eq('user_id', user.id)
    .eq('channel', 'in_app')
    .eq('status', 'pending')
    .select('id');
  return { marked: data?.length ?? 0 };
}
