/**
 * O2-5 — Guard de ESCRITURA sin conexión (ADR-0020 Decisión 5: offline = SOLO
 * lectura). Puro: recibe `isOnline` (lo resuelve la capa nativa con su detector)
 * y bloquea la mutación cuando no hay red, para que la UI muestre el aviso "sin
 * conexión". NO hay cola de sincronización ni reintentos: la escritura
 * simplemente no ocurre offline.
 */

/** Error lanzado al intentar una escritura sin conexión. */
export class OfflineError extends Error {
  constructor(message = 'offline') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function isOfflineError(err: unknown): err is OfflineError {
  return err instanceof OfflineError;
}

/** Lanza `OfflineError` si no hay conexión. */
export function assertOnline(isOnline: boolean): void {
  if (!isOnline) throw new OfflineError();
}

/**
 * Envuelve una mutación: si no hay conexión NO la ejecuta (lanza `OfflineError`);
 * si la hay, delega en `fn`. Las tandas que escriben (E) usan esto + un estado de
 * red para pintar el aviso.
 */
export async function guardedWrite<T>(
  isOnline: boolean,
  fn: () => Promise<T>
): Promise<T> {
  assertOnline(isOnline);
  return fn();
}
