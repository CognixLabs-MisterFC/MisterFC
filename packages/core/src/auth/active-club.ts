import type { CurrentUserClub } from './current-user';

export const ACTIVE_CLUB_COOKIE_NAME = 'active_club_id';

/**
 * Resuelve el club activo del user a partir de la lista de sus clubs y el
 * valor de la cookie `active_club_id`.
 *
 * Reglas:
 *   - Si la cookie apunta a un club al que pertenece → devuelve ese.
 *   - Si la cookie está vacía o apunta a un club al que NO pertenece → primer club por orden alfabético.
 *   - Si no tiene clubs → null.
 *
 * `staleCookie` se marca true cuando la cookie existía pero apuntaba a un club inválido,
 * para que la capa que llama pueda reescribirla.
 */
export function resolveActiveClub(
  clubs: CurrentUserClub[],
  cookieValue: string | null | undefined
): { active: CurrentUserClub | null; staleCookie: boolean } {
  if (clubs.length === 0) {
    return { active: null, staleCookie: false };
  }

  if (cookieValue) {
    const match = clubs.find((c) => c.club.id === cookieValue);
    if (match) {
      return { active: match, staleCookie: false };
    }
    return { active: clubs[0]!, staleCookie: true };
  }

  return { active: clubs[0]!, staleCookie: false };
}
