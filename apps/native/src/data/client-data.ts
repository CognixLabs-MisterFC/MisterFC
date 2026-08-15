import { readThrough, type ReadThroughResult } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { getCanFetch } from './connectivity';
import { secureCacheBacking } from './secure-cache-backing';
import { coalesceFetch } from './request-coalescing';

/** Cliente supabase tipado de la app nativa. */
export type NativeDbClient = typeof supabase;

export type FetchCachedOptions<T> = {
  /**
   * SWR: se invoca cuando llega el dato FRESCO de la revalidación en 2º plano
   * (o, si esa revalidación falla, con la caché + banner). Ver core `readThrough`.
   */
  onRevalidated?: (result: ReadThroughResult<T>) => void;
};

/**
 * O2-5 — Patrón común de LECTURA de la app: ejecuta un `getXFromClient` de core
 * con el cliente de native y una caché de lectura offline (secure-store) por
 * debajo. Las tandas B-E cuelgan aquí sus fetch, p.ej.:
 *
 *   const { data, fromCache } = await fetchCached(
 *     clubScopedCacheKey('calendar', clubId),
 *     (sb) => getCalendarDataFromClient(sb, clubId, range),
 *   );
 *
 * STALE-WHILE-REVALIDATE (ver core `readThrough`): con caché la devuelve al
 * instante y refresca por detrás avisando por `onRevalidated`; sin caché bloquea
 * en la primera carga. El gate online es PERMISIVO (`getCanFetch`): solo sin radio
 * se sirve caché sin intentar red. El fetcher va envuelto en `coalesceFetch` para
 * deduplicar peticiones en vuelo de la misma key.
 */
export async function fetchCached<T>(
  cacheKey: string,
  fetcher: (sb: NativeDbClient) => Promise<T>,
  options?: FetchCachedOptions<T>,
): Promise<ReadThroughResult<T>> {
  const isOnline = await getCanFetch();
  return readThrough(
    cacheKey,
    () => coalesceFetch(cacheKey, () => fetcher(supabase)),
    {
      isOnline,
      backing: secureCacheBacking,
      onRevalidated: options?.onRevalidated,
    },
  );
}
