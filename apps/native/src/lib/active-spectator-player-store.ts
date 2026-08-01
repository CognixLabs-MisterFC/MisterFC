import * as SecureStore from 'expo-secure-store';

/**
 * O2-6 — Persistencia del JUGADOR SEGUIDO ACTIVO (el niño elegido por el seguidor)
 * en expo-secure-store. Calcado de `active-player-store.ts` pero con CLAVE PROPIA:
 * el seguidor no tiene club/hijos, sigue jugadores directamente (player_spectators),
 * así que su "activo" es independiente del jugador activo del tutor. Valor = UUID
 * del player (< 2048 bytes → SecureStore directo).
 */
const ACTIVE_SPECTATOR_PLAYER_KEY = 'active_spectator_player_id';

export async function getStoredSpectatorPlayerId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_SPECTATOR_PLAYER_KEY);
}

export async function setStoredSpectatorPlayerId(playerId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_SPECTATOR_PLAYER_KEY, playerId);
}

export async function clearStoredSpectatorPlayerId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_SPECTATOR_PLAYER_KEY);
}
