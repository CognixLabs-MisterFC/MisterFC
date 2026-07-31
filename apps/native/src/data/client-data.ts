import { readThrough, type ReadThroughResult } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { getIsOnline } from './connectivity';
import { secureCacheBacking } from './secure-cache-backing';

/** Cliente supabase tipado de la app nativa. */
export type NativeDbClient = typeof supabase;

/**
 * O2-5 — Patrón común de LECTURA de la app: ejecuta un `getXFromClient` de core
 * con el cliente de native y una caché de lectura offline (secure-store) por
 * debajo. Las tandas B-E cuelgan aquí sus fetch, p.ej.:
 *
 *   const { data, fromCache } = await fetchCached(
 *     `calendar:${clubId}`,
 *     (sb) => getCalendarDataFromClient(sb, clubId, range),
 *   );
 *
 * Cache-first con revalidación (ver core `readThrough`): online refresca y cachea;
 * offline devuelve lo último guardado. `fromCache` avisa a la UI de que son datos
 * guardados.
 */
export async function fetchCached<T>(
  cacheKey: string,
  fetcher: (sb: NativeDbClient) => Promise<T>,
): Promise<ReadThroughResult<T>> {
  const isOnline = await getIsOnline();
  return readThrough(cacheKey, () => fetcher(supabase), {
    isOnline,
    backing: secureCacheBacking,
  });
}
