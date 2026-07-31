import { useCallback, useEffect, useState } from 'react';
import { fetchCached, type NativeDbClient } from './client-data';

/**
 * O2-5 B1 — Hook de LECTURA con caché offline. Envuelve `fetchCached` (Tanda A):
 * cache-first con revalidación. `fromCache=true` → los datos son la última copia
 * guardada (sin conexión) y la UI pinta el banner "sin conexión". `refresh()`
 * fuerza una recarga (polling de Directos). La KEY debe incluir el id del recurso
 * (clubId) — norma de la Tanda A.
 */
export type CachedState<T> = {
  data: T | null;
  fromCache: boolean;
  loading: boolean;
  refresh: () => void;
};

export function useCached<T>(
  cacheKey: string,
  fetcher: (sb: NativeDbClient) => Promise<T>,
): CachedState<T> {
  const [data, setData] = useState<T | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetchCached(cacheKey, fetcher);
      if (!active) return;
      setData(r.data);
      setFromCache(r.fromCache);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // fetcher se recrea por render; la key + tick gobiernan la recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick]);

  return { data, fromCache, loading, refresh };
}
