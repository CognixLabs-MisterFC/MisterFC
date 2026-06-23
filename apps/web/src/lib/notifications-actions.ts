'use server';

/**
 * PART 3.4 — marcar como leídas (pending → sent) las notificaciones in_app de
 * ciertos tipos cuando el user abre la lista correspondiente. El propio user
 * puede hacer esta transición (RLS notifications_update_own_read + trigger que
 * fuerza sent_at). Devuelve cuántas marcó para que el cliente decida refrescar.
 */

import {
  createSupabaseServerClient,
  type Database,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type NotificationType = Database['public']['Enums']['notification_type'];

export async function markNotificationsRead(
  types: NotificationType[],
): Promise<{ marked: number }> {
  if (types.length === 0) return { marked: 0 };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

/**
 * F13.9b — marca UNA notificación in_app como leída (pending → sent) por id, al
 * navegar a ella desde el feed de novedades. Misma transición/RLS que el marcado
 * por tipo; aquí keyed por id (el `eq('user_id')` es redundante con la RLS pero
 * deja explícito el scope). No-op si ya estaba leída o no es del usuario.
 */
export async function markNotificationRead(id: string): Promise<{ marked: number }> {
  if (!id) return { marked: 0 };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

/**
 * F13.9b — "marcar todas como leídas": pasa a sent TODAS las in_app pendientes
 * del usuario, de cualquier tipo. Esto vacía también los contadores del sidebar
 * (callup_* y new_announcement), que recuentan pendientes; el cliente refresca
 * tras llamar para resincronizar badges + feed. No se toca la lógica de conteo.
 */
export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
