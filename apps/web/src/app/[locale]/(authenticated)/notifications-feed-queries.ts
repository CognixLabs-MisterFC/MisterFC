/**
 * F13.9a/b — Feed de novedades. O2-5 B1: las queries se extrajeron a core
 * (`getNotificationFeedFromClient`, `getNotificationsPageFromClient`,
 * `getUnreadNotificationsCountFromClient`); estos son wrappers de compatibilidad,
 * misma firma y comportamiento (RLS select-own filtra por usuario).
 */

import {
  createSupabaseServerClient,
  getNotificationFeedFromClient,
  getNotificationsPageFromClient,
  getUnreadNotificationsCountFromClient,
  FEED_LIMIT as CORE_FEED_LIMIT,
  NOVEDADES_PAGE_SIZE as CORE_PAGE_SIZE,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { InAppNotificationRow } from './notifications-feed';

export const FEED_LIMIT = CORE_FEED_LIMIT;
export const NOVEDADES_PAGE_SIZE = CORE_PAGE_SIZE;

export async function loadNotificationFeed(
  limit: number = FEED_LIMIT,
): Promise<InAppNotificationRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getNotificationFeedFromClient(supabase, limit);
}

export async function loadNotificationsPage(
  page: number,
): Promise<{ rows: InAppNotificationRow[]; total: number }> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getNotificationsPageFromClient(supabase, page, NOVEDADES_PAGE_SIZE);
}

export async function countUnreadNotifications(): Promise<number> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getUnreadNotificationsCountFromClient(supabase);
}
