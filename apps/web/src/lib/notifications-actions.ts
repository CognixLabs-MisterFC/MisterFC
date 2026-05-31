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
