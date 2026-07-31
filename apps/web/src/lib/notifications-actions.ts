'use server';

/**
 * PART 3.4 / F13.9b — marcar notificaciones in_app como leídas. O2-5 B1: la
 * lógica se extrajo a core (`mark*FromClient`); estos server actions delegan.
 * Comportamiento idéntico (RLS notifications_update_own_read + trigger sent_at).
 */

import {
  createSupabaseServerClient,
  markNotificationsReadFromClient,
  markNotificationReadFromClient,
  markAllNotificationsReadFromClient,
  type Database,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type NotificationType = Database['public']['Enums']['notification_type'];

export async function markNotificationsRead(
  types: NotificationType[],
): Promise<{ marked: number }> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  return markNotificationsReadFromClient(supabase, types);
}

export async function markNotificationRead(
  id: string,
): Promise<{ marked: number }> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  return markNotificationReadFromClient(supabase, id);
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  return markAllNotificationsReadFromClient(supabase);
}
