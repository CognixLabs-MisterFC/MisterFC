import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchCached, type NativeDbClient } from './client-data';
import { msSinceLastFetch } from './request-coalescing';
import { subscribeInvalidation } from './cache-bus';
import { reportDataError } from '@/lib/report-error';

/**
 * O2 — Hook de LECTURA con caché offline y STALE-WHILE-REVALIDATE.
 *
 * Comportamiento (todo CENTRAL, sin parchear pantallas):
 *  - Montaje / cambio de key → carga inicial (con `loading`); SWR pinta la caché
 *    al instante y refresca por detrás (`onRevalidated` actualiza la UI).
 *  - REFETCH AL ENFOCAR → al volver a la pantalla se reconsulta en 2º plano
 *    (sin spinner), saltando el primer foco (ya lo cubre la carga inicial) y
 *    respetando un INTERVALO MÍNIMO para no tormentar al alternar pestañas.
 *  - REFETCH AL VOLVER DE BACKGROUND (invalidación de caché · Parte 2) → al pasar
 *    la app a `active`, la pantalla ENFOCADA revalida en 2º plano (el mismo
 *    `run(key,false)` y el mismo intervalo mínimo que el foco). Cubre el hueco de
 *    quien deja la app abierta en una pantalla y vuelve horas después (p.ej. la
 *    familia en el detalle de una convocatoria cambiada en la web). Solo la
 *    enfocada, para no disparar N consultas de todas las pantallas montadas.
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

    try {
      const r = await fetchCached<T>(key, (sb) => fetcherRef.current(sb), {
        onRevalidated: apply,
      });
      apply(r);
    } catch (err) {
      // `fetchCached` normalmente NO rechaza (readThrough captura el fetcher), pero
      // la caché (secure-store) puede lanzar antes de ese try; si no lo cubriéramos,
      // el `finally` no correría y la carga quedaría colgada PARA SIEMPRE (spinner
      // eterno, E5). Reportamos a Sentry (antes se tragaba sin rastro) usando SOLO
      // el token de recurso de la key (sin ids → sin PII).
      reportDataError(`read:${key.split('.')[0]}`, err);
    } finally {
      // Pase lo que pase, la carga inicial DEJA de estar cargando: nunca un spinner
      // que no resuelve.
      if (showLoading && mountedRef.current && keyRef.current === key) {
        setLoading(false);
      }
    }
  }, []);

  // Carga inicial + cambio de key (visible, con spinner).
  useEffect(() => {
    void run(cacheKey, true);
  }, [cacheKey, run]);

  // Refetch al enfocar: salta el primer foco (la carga inicial ya cargó) y respeta
  // el intervalo mínimo. En 2º plano (sin spinner). Además, `focusedRef` marca si
  // ESTA pantalla está enfocada: lo lee el listener de background (abajo) para que
  // solo revalide la pantalla visible. El cleanup del foco lo pone a false SIEMPRE
  // (blur o desmontaje), así nunca queda en true tras salir de la pantalla.
  const firstFocus = useRef(true);
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (firstFocus.current) {
        firstFocus.current = false;
      } else if (msSinceLastFetch(keyRef.current) >= FOCUS_REFETCH_MIN_INTERVAL_MS) {
        void run(keyRef.current, false);
      }
      return () => {
        focusedRef.current = false;
      };
    }, [run]),
  );

  // Refetch al VOLVER DE BACKGROUND: solo la pantalla enfocada y con el intervalo
  // mínimo cumplido → mismo `run(key,false)` que el foco (2º plano, coalesced). Lee
  // `keyRef.current` (nunca una key vieja tras cambiarla). `run` es estable (deps []),
  // así que el listener se registra UNA vez y se retira en el cleanup al desmontar:
  // nunca sobrevive a la pantalla ni revalida keys muertas.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (
        next === 'active' &&
        focusedRef.current &&
        msSinceLastFetch(keyRef.current) >= FOCUS_REFETCH_MIN_INTERVAL_MS
      ) {
        void run(keyRef.current, false);
      }
    });
    return () => sub.remove();
  }, [run]);

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
