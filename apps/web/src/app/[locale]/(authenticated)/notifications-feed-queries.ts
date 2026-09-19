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
  imageConsentPlayerIds,
  loadImageConsentPlayersFromClient,
  NO_IMAGE_CONSENT_PLAYERS,
  type ImageConsentPlayers,
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

/**
 * Imagen-2 — Jugadores (nombre + foto firmada) de los avisos de retirada de imagen
 * que haya en ESTA página del feed. Una sola consulta para toda la página, y solo
 * si hay alguno: el feed se pinta en cada carga de Inicio y no puede pagar una
 * consulta por fila. Sin avisos de ese tipo (el caso normal) no toca la red.
 */
export async function loadImageConsentPlayers(
  rows: readonly InAppNotificationRow[],
): Promise<ImageConsentPlayers> {
  const ids = imageConsentPlayerIds(rows);
  if (ids.length === 0) return NO_IMAGE_CONSENT_PLAYERS;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return loadImageConsentPlayersFromClient(supabase, ids);
}
