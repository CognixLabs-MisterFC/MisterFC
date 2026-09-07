import * as SecureStore from 'expo-secure-store';

/**
 * F14J-5A — El club elegido ANTES de identificarse, recordado en el dispositivo.
 *
 * Es un concepto distinto de `active-club-store` y por eso vive aparte:
 *
 *   · `active_club_id`   → con sesión, cuál de MIS clubes miro (uuid).
 *   · `login_club_slug`  → sin sesión, por qué puerta entro (slug).
 *
 * Se guarda el SLUG y no el id porque es lo que resuelve
 * `get_public_club_by_slug`, es estable (columna UNIQUE con CHECK de formato) y
 * es lo que ya usa la web en misterfc.es/{slug}.
 *
 * La clave lleva '_' y nunca ':': expo-secure-store valida las claves con
 * /^[\w.-]+$/ y un ':' tumba la app en el primer `setItemAsync` EN DISPOSITIVO
 * (el CI no lo caza, usa un backing en memoria). Ver la nota del #529 en
 * `secure-store-adapter.ts`.
 *
 * No es un dato sensible —un slug es público—, pero va en el almacén cifrado
 * como todo lo demás: ADR-0020 prohíbe AsyncStorage en esta app.
 */
const LOGIN_CLUB_KEY = 'login_club_slug';

export async function getStoredLoginClubSlug(): Promise<string | null> {
  return SecureStore.getItemAsync(LOGIN_CLUB_KEY);
}

export async function setStoredLoginClubSlug(slug: string): Promise<void> {
  await SecureStore.setItemAsync(LOGIN_CLUB_KEY, slug);
}

export async function clearStoredLoginClubSlug(): Promise<void> {
  await SecureStore.deleteItemAsync(LOGIN_CLUB_KEY);
}
