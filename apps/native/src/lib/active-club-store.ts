import * as SecureStore from 'expo-secure-store';

/**
 * Persistencia del CLUB ACTIVO en expo-secure-store (ADR-0020: nada sensible en
 * AsyncStorage). Espejo del concepto de la cookie `active_club_id` de apps/web,
 * pero en el almacén cifrado del dispositivo — clave PROPIA, no la cookie HTTP.
 *
 * El valor es un UUID (< 2048 bytes) → SecureStore directo, sin trocear (el
 * troceo del adaptador de sesión no hace falta aquí).
 */
const ACTIVE_CLUB_KEY = 'active_club_id';

export async function getStoredActiveClubId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_CLUB_KEY);
}

export async function setStoredActiveClubId(clubId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_CLUB_KEY, clubId);
}

export async function clearStoredActiveClubId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_CLUB_KEY);
}
