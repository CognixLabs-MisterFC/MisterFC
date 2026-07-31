import * as SecureStore from 'expo-secure-store';

/**
 * O2-5 — Persistencia del JUGADOR ACTIVO (hijo elegido por el tutor) en
 * expo-secure-store. Calcado de `active-club-store.ts`: clave propia en el almacén
 * cifrado (ADR-0020: nada sensible en AsyncStorage), valor = UUID del player
 * (< 2048 bytes → SecureStore directo, sin trocear).
 *
 * DEPENDE del club activo: los hijos son por club, así que el `ActivePlayerProvider`
 * revalida/resetea este valor al cambiar de club. Aquí solo el get/set/clear.
 */
const ACTIVE_PLAYER_KEY = 'active_player_id';

export async function getStoredActivePlayerId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_PLAYER_KEY);
}

export async function setStoredActivePlayerId(playerId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_PLAYER_KEY, playerId);
}

export async function clearStoredActivePlayerId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_PLAYER_KEY);
}
