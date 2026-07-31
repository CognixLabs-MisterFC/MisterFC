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

/**
 * Norma de KEYS de caché (O2-5): datos club-scoped llevan el `clubId` en la key,
 * para que al cambiar de club la key sea DISTINTA y no se sirva la caché del club
 * anterior. p.ej. `clubScopedCacheKey('calendar', clubId)` → 'calendar::<clubId>'.
 */
export function clubScopedCacheKey(resource: string, clubId: string): string {
  return `${resource}::${clubId}`;
}

/**
 * Variante event-scoped (O2-5 B2): datos de un evento concreto (p.ej. el detalle
 * de un directo) llevan el `eventId` en la key. El eventId ya es único global, así
 * que no hace falta el clubId. p.ej. `eventScopedCacheKey('directo', eventId)` →
 * 'directo::<eventId>'. Evento distinto → key distinta.
 */
export function eventScopedCacheKey(resource: string, eventId: string): string {
  return `${resource}::${eventId}`;
}

/**
 * Variante PLAYER-scoped (O2-5 C1): datos del hijo activo (ficha/informe/
 * seguidores) llevan clubId Y playerId en la key. Es la norma MÁS crítica de la
 * tanda: son datos personales/deportivos de un MENOR; cambiar de hijo DEBE dar una
 * key distinta para NUNCA servir offline la ficha del hijo equivocado. p.ej.
 * `playerScopedCacheKey('ficha', clubId, playerId)` → 'ficha::<clubId>::<playerId>'.
 */
export function playerScopedCacheKey(
  resource: string,
  clubId: string,
  playerId: string
): string {
  return `${resource}::${clubId}::${playerId}`;
}

/**
 * Variante TEAM-scoped (O2-5 D1): datos de un EQUIPO concreto (plantilla, staff,
 * sesiones, home) llevan clubId Y teamId en la key. En "Mi equipo" el equipo se
 * deriva del hijo activo, pero el DATO pertenece al equipo (dos hermanos del mismo
 * equipo comparten caché); por eso se escopa por teamId, no por playerId. Cambiar
 * de equipo → key distinta. p.ej. `teamScopedCacheKey('plantilla', clubId, teamId)`
 * → 'plantilla::<clubId>::<teamId>'.
 */
export function teamScopedCacheKey(
  resource: string,
  clubId: string,
  teamId: string
): string {
  return `${resource}::${clubId}::${teamId}`;
}

/**
 * Variante PLAYER+EVENT-scoped (O2-5 E1): datos de un evento concreto vistos POR
 * el hijo activo (detalle de convocatoria, fila del hijo en las stats del
 * partido). Llevan clubId, playerId Y eventId. El playerId es la parte crítica —
 * dos hermanos ven el MISMO evento con datos DISTINTOS (su respuesta/su fila), así
 * que cambiar de hijo DEBE dar key distinta aunque el evento sea el mismo. p.ej.
 * `playerEventScopedCacheKey('convocatoria', clubId, playerId, eventId)` →
 * 'convocatoria::<clubId>::<playerId>::<eventId>'.
 */
export function playerEventScopedCacheKey(
  resource: string,
  clubId: string,
  playerId: string,
  eventId: string
): string {
  return `${resource}::${clubId}::${playerId}::${eventId}`;
}

/**
 * Variante PROFILE-scoped (O2-5 E2a): datos que cuelgan del PERFIL del usuario
 * (no del club ni del hijo), como el inbox de mensajería — los hilos son del
 * tutor, compartidos entre sus hijos. Llevan el profileId en la key. p.ej.
 * `profileScopedCacheKey('inbox', profileId)` → 'inbox::<profileId>'.
 */
export function profileScopedCacheKey(
  resource: string,
  profileId: string
): string {
  return `${resource}::${profileId}`;
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
