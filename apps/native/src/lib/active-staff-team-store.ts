import * as SecureStore from 'expo-secure-store';

/**
 * O2-10b-2 — Persistencia del EQUIPO ACTIVO del coordinador en expo-secure-store.
 * Calcado de `active-spectator-player-store.ts` / `active-player-store.ts` pero con
 * CLAVE PROPIA: un usuario podría ser coordinador (varios equipos) Y tutor (hijos) a
 * la vez, así que su equipo activo es independiente del hijo/jugador activo y del
 * club activo. Valor = UUID del team (< 2048 bytes → SecureStore directo).
 */
const ACTIVE_STAFF_TEAM_KEY = 'active_staff_team_id';

export async function getStoredStaffTeamId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_STAFF_TEAM_KEY);
}

export async function setStoredStaffTeamId(teamId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_STAFF_TEAM_KEY, teamId);
}

export async function clearStoredStaffTeamId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_STAFF_TEAM_KEY);
}
