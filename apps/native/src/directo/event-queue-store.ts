import { SecureStoreAdapter } from '@/lib/secure-store-adapter';
import { EMPTY_QUEUE, type EventQueue } from '@misterfc/core';

/**
 * O2-9b — PERSISTENCIA de la cola de eventos del directo (una por partido activo).
 *
 * ¿Dónde persiste y por qué SECURE-STORE (no filesystem/AsyncStorage)?
 *  - Las filas encoladas llevan `player_id` = el id de un MENOR (nuestro jugador).
 *    ADR-0020 exige el almacén CIFRADO del dispositivo para datos de menores y
 *    PROHÍBE AsyncStorage/filesystem sin cifrar → va a expo-secure-store, igual
 *    que la sesión y la caché de lectura (`secureCacheBacking`).
 *  - Reutiliza el `SecureStoreAdapter` (mismo troceo en fragmentos): SecureStore
 *    limita cada valor a ~2048 bytes en Android; una cola con varios eventos como
 *    JSON los supera, así que el troceo del adaptador es IMPRESCINDIBLE aquí.
 *
 * La cola SOBREVIVE al cierre de la app: si el entrenador cierra a mitad del
 * partido con eventos pendientes, al reabrir el directo se carga de aquí y se
 * drena. Es el fallo (perder un gol) que toda esta pieza existe para evitar → la
 * persistencia es REAL, no en memoria.
 *
 * Clave POR EVENTO (`directo-queue.<eventId>`): un partido a la vez, pero cada
 * partido tiene su cola aislada (cambiar de directo no mezcla eventos). Separador
 * '.' (no ':'): expo-secure-store rechaza ':' en la clave (SecureStore.js:151).
 */
const queueKey = (eventId: string) => `directo-queue.${eventId}`;

export async function loadQueue(eventId: string): Promise<EventQueue> {
  const raw = await SecureStoreAdapter.getItem(queueKey(eventId));
  if (raw == null) return EMPTY_QUEUE;
  try {
    const parsed = JSON.parse(raw) as EventQueue;
    return Array.isArray(parsed) ? parsed : EMPTY_QUEUE;
  } catch {
    // Cola corrupta: NO se descarta a ciegas (podría llevar un gol). Se conserva
    // el string intacto en el almacén; devolvemos vacío para no romper la UI y se
    // reintentará leer/parsear en la siguiente carga. En la práctica el JSON que
    // nosotros escribimos siempre es válido.
    return EMPTY_QUEUE;
  }
}

export async function saveQueue(eventId: string, queue: EventQueue): Promise<void> {
  await SecureStoreAdapter.setItem(queueKey(eventId), JSON.stringify(queue));
}

export async function clearQueue(eventId: string): Promise<void> {
  await SecureStoreAdapter.removeItem(queueKey(eventId));
}
