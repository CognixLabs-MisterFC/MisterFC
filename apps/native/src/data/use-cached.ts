import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchCached, type NativeDbClient } from './client-data';
import { msSinceLastFetch } from './request-coalescing';
import { subscribeInvalidation } from './cache-bus';

/**
 * O2 — Hook de LECTURA con caché offline y STALE-WHILE-REVALIDATE.
 *
 * Comportamiento (todo CENTRAL, sin parchear pantallas):
 *  - Montaje / cambio de key → carga inicial (con `loading`); SWR pinta la caché
 *    al instante y refresca por detrás (`onRevalidated` actualiza la UI).
 *  - REFETCH AL ENFOCAR → al volver a la pantalla se reconsulta en 2º plano
 *    (sin spinner), saltando el primer foco (ya lo cubre la carga inicial) y
 *    respetando un INTERVALO MÍNIMO para no tormentar al alternar pestañas.
 *  - INVALIDACIÓN por escritura → recarga inmediata (ignora el intervalo mínimo).
 *  - `refresh()` fuerza una recarga (lo usa el polling de Directos).
 *
 * `fromCache=true` → datos guardados/obsoletos: la UI pinta el banner "sin
 * conexión". La KEY debe incluir el id del recurso (clubId, etc.) — norma O2-5.
 */

/**
 * Refetch-al-enfocar: si esta key se consultó hace menos de esto, el foco NO
 * recarga. 10 s coalescen las ráfagas de navegación rápida (entrar/salir/entrar)
 * pero dejan fresco a quien vuelve tras un rato; y queda por debajo del polling
 * del directo (15 s) para no competir con él. La invalidación por escritura y
 * `refresh()` se lo saltan (siempre recargan).
 */
const FOCUS_REFETCH_MIN_INTERVAL_MS = 10_000;

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

  // Refs sincronizadas FUERA de render (React Compiler prohíbe escribir refs en
  // render). `fetcherRef` guarda el fetcher (se recrea cada render) para no
  // dispararse como dependencia; `keyRef` la key vigente, para descartar
  // respuestas (incluida la revalidación SWR diferida) de una key anterior tras
  // cambiar de recurso. Este effect va PRIMERO: al cambiar `cacheKey`, `keyRef`
  // queda actualizada antes de que corra el effect de carga de más abajo.
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(cacheKey);
  useEffect(() => {
    fetcherRef.current = fetcher;
    keyRef.current = cacheKey;
  });

  // Evita setState tras desmontar.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (key: string, showLoading: boolean) => {
    if (showLoading && mountedRef.current) setLoading(true);

    // Aplica un resultado solo si seguimos montados y en la misma key (protege de
    // carreras: revalidación diferida vs. cambio de recurso / desmontaje).
    const apply = (r: { data: T | null; fromCache: boolean }) => {
      if (!mountedRef.current || keyRef.current !== key) return;
      setData(r.data);
      setFromCache(r.fromCache);
    };

    const r = await fetchCached<T>(key, (sb) => fetcherRef.current(sb), {
      onRevalidated: apply,
    });
    apply(r);

    if (showLoading && mountedRef.current && keyRef.current === key) {
      setLoading(false);
    }
  }, []);

  // Carga inicial + cambio de key (visible, con spinner).
  useEffect(() => {
    void run(cacheKey, true);
  }, [cacheKey, run]);

  // Refetch al enfocar: salta el primer foco (la carga inicial ya cargó) y respeta
  // el intervalo mínimo. En 2º plano (sin spinner).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (msSinceLastFetch(keyRef.current) >= FOCUS_REFETCH_MIN_INTERVAL_MS) {
        void run(keyRef.current, false);
      }
    }, [run]),
  );

  // Invalidación por escritura → recarga inmediata (ignora el intervalo mínimo).
  useEffect(() => {
    return subscribeInvalidation(cacheKey, () => {
      void run(cacheKey, false);
    });
  }, [cacheKey, run]);

  const refresh = useCallback(() => {
    void run(keyRef.current, false);
  }, [run]);

  return { data, fromCache, loading, refresh };
}
