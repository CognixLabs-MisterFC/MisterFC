/**
 * O2-5 — Caché de LECTURA para offline (ADR-0020 Decisión 5).
 *
 * Política CACHE-FIRST-CON-REVALIDACIÓN, pura y con el almacenamiento INYECTADO
 * (`CacheBacking`): así el criterio se testea en core sin tocar el disco, y la
 * app nativa provee el backing real (secure-store cifrado, exigido para datos de
 * menores/médicos — ver `apps/native`). Web no la usa.
 *
 * Reglas de `readThrough`:
 *   - ONLINE  → intenta `fetcher`; si va, guarda en caché y devuelve fresco;
 *               si el fetch FALLA (red intermitente), cae a lo cacheado.
 *   - OFFLINE → devuelve directamente lo cacheado (o `null` si no hay nada).
 *
 * `fromCache` indica de dónde salió el dato (para que la UI marque "sin conexión"
 * / "datos guardados"). NO hay cola de escritura: esto es SOLO lectura.
 */

/** Almacenamiento clave→string que provee la app (p.ej. secure-store). */
export type CacheBacking = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type ReadThroughResult<T> = {
  /** Dato resuelto (fresco o cacheado); `null` si offline y sin caché, o fetch fallido sin caché. */
  data: T | null;
  /** true si el dato vino de la caché (offline, o fallback por fetch fallido). */
  fromCache: boolean;
};

const PREFIX = 'rcache::';

export async function cacheGet<T>(
  backing: CacheBacking,
  key: string
): Promise<T | null> {
  const raw = await backing.getItem(PREFIX + key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Caché corrupta → se ignora (se revalidará al haber red).
    return null;
  }
}

export async function cacheSet<T>(
  backing: CacheBacking,
  key: string,
  value: T
): Promise<void> {
  await backing.setItem(PREFIX + key, JSON.stringify(value));
}

export async function cacheClear(
  backing: CacheBacking,
  key: string
): Promise<void> {
  await backing.removeItem(PREFIX + key);
}

export async function readThrough<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { isOnline: boolean; backing: CacheBacking }
): Promise<ReadThroughResult<T>> {
  const { isOnline, backing } = opts;

  if (!isOnline) {
    const cached = await cacheGet<T>(backing, key);
    return { data: cached, fromCache: true };
  }

  try {
    const fresh = await fetcher();
    await cacheSet(backing, key, fresh);
    return { data: fresh, fromCache: false };
  } catch {
    // Red intermitente / fetch fallido → cae a lo último cacheado si existe.
    const cached = await cacheGet<T>(backing, key);
    return { data: cached, fromCache: true };
  }
}
