/**
 * O2-5 — Caché de LECTURA para offline (ADR-0020 Decisión 5).
 *
 * Política STALE-WHILE-REVALIDATE, pura y con el almacenamiento INYECTADO
 * (`CacheBacking`): así el criterio se testea en core sin tocar el disco, y la
 * app nativa provee el backing real (secure-store cifrado, exigido para datos de
 * menores/médicos — ver `apps/native`). Web no la usa.
 *
 * Reglas de `readThrough`:
 *   - OFFLINE (sin radio) → devuelve directamente lo cacheado (o `null`) y marca
 *     `fromCache=true` (banner "sin conexión"). No intenta red.
 *   - ONLINE con CACHÉ → devuelve lo cacheado DE INMEDIATO (`fromCache=false`) y
 *     revalida EN SEGUNDO PLANO; cuando llega lo fresco se avisa por
 *     `onRevalidated` para que la UI se actualice. Si la revalidación falla, se
 *     mantiene la caché ya mostrada y `onRevalidated` marca `fromCache=true`.
 *   - ONLINE sin CACHÉ → primera carga: BLOQUEA en `fetcher` (no hay nada que
 *     mostrar); si va, cachea y devuelve fresco; si falla, `null` + banner.
 *
 * `fromCache` indica si la UI debe pintar el banner "sin conexión / datos
 * guardados". NO hay cola de escritura: esto es SOLO lectura.
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
  /** true si la UI debe pintar el banner (offline, o revalidación/fetch fallidos). */
  fromCache: boolean;
};

// Separador '.' (antes ':' doble, inválido): expo-secure-store valida las claves
// con /^[\w.-]+$/
// (SecureStore.js:151), así que ':' es inválido y revienta EN DISPOSITIVO (no en
// CI, que inyecta un backing en memoria). El '.' es válido, no colisiona (ni los
// resource ni los ids llevan puntos) y es el que menos ruido introduce.
const PREFIX = 'rcache.';

// Regla de expo-secure-store: las claves solo admiten /^[\w.-]+$/ (SecureStore.js:151).
// Un ':' (o cualquier otro carácter) NO revienta en CI —el backing de tests es un Map
// en memoria— sino EN DISPOSITIVO, y de forma DIFERIDA: la caché lanza ANTES de que el
// fetcher corra, así que la pantalla sale vacía y el fallo se reporta como
// `read:<recurso>` sin pista del culpable. Por eso los builders RECHAZAN aquí, en
// construcción: quien arma una clave inválida se entera al instante (throw ruidoso), no
// vía una pantalla muda y un Sentry despistado. RECHAZA, no normaliza: normalizar en
// silencio escondería el error que queremos hacer visible.
const SECURE_STORE_KEY_RE = /^[\w.-]+$/;

function assertValidCacheKey(key: string): string {
  if (!SECURE_STORE_KEY_RE.test(key)) {
    throw new Error(
      `Clave de caché inválida para expo-secure-store: ${JSON.stringify(key)}. ` +
        'Solo se admiten [A-Za-z0-9_.-] (SecureStore valida con /^[\\w.-]+$/): ' +
        "usa '.' como separador, nunca ':'.",
    );
  }
  return key;
}

/**
 * Norma de KEYS de caché (O2-5): datos club-scoped llevan el `clubId` en la key,
 * para que al cambiar de club la key sea DISTINTA y no se sirva la caché del club
 * anterior. p.ej. `clubScopedCacheKey('calendar', clubId)` → 'calendar.<clubId>'.
 */
export function clubScopedCacheKey(resource: string, clubId: string): string {
  return assertValidCacheKey(`${resource}.${clubId}`);
}

/**
 * Variante event-scoped (O2-5 B2): datos de un evento concreto (p.ej. el detalle
 * de un directo) llevan el `eventId` en la key. El eventId ya es único global, así
 * que no hace falta el clubId. p.ej. `eventScopedCacheKey('directo', eventId)` →
 * 'directo.<eventId>'. Evento distinto → key distinta.
 */
export function eventScopedCacheKey(resource: string, eventId: string): string {
  return assertValidCacheKey(`${resource}.${eventId}`);
}

/**
 * Variante PLAYER-scoped (O2-5 C1): datos del hijo activo (ficha/informe/
 * seguidores) llevan clubId Y playerId en la key. Es la norma MÁS crítica de la
 * tanda: son datos personales/deportivos de un MENOR; cambiar de hijo DEBE dar una
 * key distinta para NUNCA servir offline la ficha del hijo equivocado. p.ej.
 * `playerScopedCacheKey('ficha', clubId, playerId)` → 'ficha.<clubId>.<playerId>'.
 */
export function playerScopedCacheKey(
  resource: string,
  clubId: string,
  playerId: string
): string {
  return assertValidCacheKey(`${resource}.${clubId}.${playerId}`);
}

/**
 * Variante TEAM-scoped (O2-5 D1): datos de un EQUIPO concreto (plantilla, staff,
 * sesiones, home) llevan clubId Y teamId en la key. En "Mi equipo" el equipo se
 * deriva del hijo activo, pero el DATO pertenece al equipo (dos hermanos del mismo
 * equipo comparten caché); por eso se escopa por teamId, no por playerId. Cambiar
 * de equipo → key distinta. p.ej. `teamScopedCacheKey('plantilla', clubId, teamId)`
 * → 'plantilla.<clubId>.<teamId>'.
 */
export function teamScopedCacheKey(
  resource: string,
  clubId: string,
  teamId: string
): string {
  return assertValidCacheKey(`${resource}.${clubId}.${teamId}`);
}

/**
 * Variante PLAYER+EVENT-scoped (O2-5 E1): datos de un evento concreto vistos POR
 * el hijo activo (detalle de convocatoria, fila del hijo en las stats del
 * partido). Llevan clubId, playerId Y eventId. El playerId es la parte crítica —
 * dos hermanos ven el MISMO evento con datos DISTINTOS (su respuesta/su fila), así
 * que cambiar de hijo DEBE dar key distinta aunque el evento sea el mismo. p.ej.
 * `playerEventScopedCacheKey('convocatoria', clubId, playerId, eventId)` →
 * 'convocatoria.<clubId>.<playerId>.<eventId>'.
 */
export function playerEventScopedCacheKey(
  resource: string,
  clubId: string,
  playerId: string,
  eventId: string
): string {
  return assertValidCacheKey(`${resource}.${clubId}.${playerId}.${eventId}`);
}

/**
 * Variante PROFILE-scoped (O2-5 E2a): datos que cuelgan del PERFIL del usuario
 * (no del club ni del hijo), como el inbox de mensajería — los hilos son del
 * tutor, compartidos entre sus hijos. Llevan el profileId en la key. p.ej.
 * `profileScopedCacheKey('inbox', profileId)` → 'inbox.<profileId>'.
 */
export function profileScopedCacheKey(
  resource: string,
  profileId: string
): string {
  return assertValidCacheKey(`${resource}.${profileId}`);
}

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
  opts: {
    isOnline: boolean;
    backing: CacheBacking;
    /**
     * STALE-WHILE-REVALIDATE: cuando había caché y se devolvió de inmediato, la
     * revalidación en 2º plano llama aquí con el resultado. Éxito → `{ data:
     * fresco, fromCache: false }`. Fallo (red intermitente) → `{ data: cacheado,
     * fromCache: true }` (para el banner). No se invoca en el resto de caminos
     * (offline, o primera carga sin caché que ya bloquea).
     */
    onRevalidated?: (result: ReadThroughResult<T>) => void;
  }
): Promise<ReadThroughResult<T>> {
  const { isOnline, backing, onRevalidated } = opts;

  // OFFLINE duro (sin radio): servir caché y banner, sin gastar red.
  if (!isOnline) {
    const cached = await cacheGet<T>(backing, key);
    return { data: cached, fromCache: true };
  }

  const cached = await cacheGet<T>(backing, key);

  // STALE-WHILE-REVALIDATE: hay caché → se devuelve YA y se revalida por detrás.
  // Online ⇒ fromCache=false (no banner): no estamos offline, solo refrescando.
  if (cached !== null) {
    void revalidate(key, fetcher, backing, onRevalidated);
    return { data: cached, fromCache: false };
  }

  // Sin caché: primera carga, hay que BLOQUEAR (no hay nada que mostrar aún).
  try {
    const fresh = await fetcher();
    await cacheSet(backing, key, fresh);
    return { data: fresh, fromCache: false };
  } catch {
    // Falló y no hay caché → null. fromCache=true para que salga el banner.
    const fallback = await cacheGet<T>(backing, key);
    return { data: fallback, fromCache: true };
  }
}

/** Revalidación en 2º plano del SWR: refresca la caché y avisa por `onRevalidated`. */
async function revalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  backing: CacheBacking,
  onRevalidated?: (result: ReadThroughResult<T>) => void
): Promise<void> {
  try {
    const fresh = await fetcher();
    await cacheSet(backing, key, fresh);
    onRevalidated?.({ data: fresh, fromCache: false });
  } catch {
    // Revalidación fallida (red intermitente): se mantiene la caché ya mostrada
    // y se avisa para que la UI pinte el banner "sin conexión".
    const stale = await cacheGet<T>(backing, key);
    onRevalidated?.({ data: stale, fromCache: true });
  }
}
