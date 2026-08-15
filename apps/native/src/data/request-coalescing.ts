/**
 * O2 — Anti-tormenta de peticiones para la capa de lectura (fetchCached/useCached).
 *
 * Dos mecanismos PUROS (sin red ni secure-store → testeables aislados):
 *
 *  1) DEDUPE IN-FLIGHT por key: si ya hay un fetch de esa key EN VUELO, se
 *     reutiliza su promesa en vez de lanzar otro. Cubre el caso de varias
 *     pantallas montadas con la misma key y el del refetch-al-enfocar solapado con
 *     la revalidación SWR.
 *
 *  2) INTERVALO MÍNIMO: `msSinceLastFetch(key)` deja al refetch-al-enfocar
 *     saltarse recargas si esa key se consultó hace poco (alternar pestañas rápido
 *     no dispara N fetches). La invalidación por escritura NO lo usa: fuerza recarga.
 *
 * El sello de "último fetch" se toma cuando el fetcher REALMENTE corre (no en los
 * caminos que resuelven desde caché sin tocar red).
 */
const inFlight = new Map<string, Promise<unknown>>();
const lastFetchAt = new Map<string, number>();

/**
 * Envuelve `fetcher` con dedupe por `key`: si hay uno en vuelo para esa key,
 * devuelve su promesa; si no, lanza y registra el sello temporal al terminar
 * (éxito o error).
 */
export function coalesceFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlight.delete(key);
      lastFetchAt.set(key, Date.now());
    }
  })();
  inFlight.set(key, pending);
  return pending;
}

/** ms desde el último fetch REAL de `key`; `Infinity` si nunca se consultó. */
export function msSinceLastFetch(key: string): number {
  const at = lastFetchAt.get(key);
  return at === undefined ? Number.POSITIVE_INFINITY : Date.now() - at;
}

/** Solo para tests: reinicia el estado del módulo. */
export function __resetCoalescingForTests(): void {
  inFlight.clear();
  lastFetchAt.clear();
}
