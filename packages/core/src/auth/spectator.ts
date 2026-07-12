/**
 * F14C-4 — Contexto del SEGUIDOR PURO (espectador).
 *
 * Espejo de `active-club.ts`, pero el seguidor no sigue clubs sino JUGADORES
 * (player_spectators, F14C-1). El "nieto activo" se guarda en la cookie
 * `active_player_id` con el mismo patrón que el club activo.
 *
 * Puro helper sin I/O (resoluble en tests): la carga de datos vive en la capa
 * de app (`spectator-shell.ts`).
 */

export const ACTIVE_PLAYER_COOKIE_NAME = 'active_player_id';

/**
 * Un jugador seguido por el espectador. Solo datos DEPORTIVOS (nombre + equipo)
 * — vienen de la vista `players_sporting` (F14C-3), nunca de `players` (cerrada
 * al seguidor). `teamId` alimenta el filtro de la AGENDA; `clubId` da el acceso
 * club-wide (directos/stats).
 */
export type FollowedPlayer = {
  playerId: string;
  clubId: string;
  fullName: string;
  teamId: string | null;
  teamName: string | null;
};

/**
 * Resuelve el jugador activo del espectador a partir de la lista de seguidos y
 * el valor de la cookie `active_player_id`.
 *
 * Reglas (idénticas a resolveActiveClub):
 *   - Cookie apunta a un jugador que sigue → ese.
 *   - Cookie vacía o inválida → primero de la lista.
 *   - Sin jugadores → null.
 *
 * `staleCookie` = true cuando la cookie existía pero apuntaba a un jugador que
 * ya no sigue, para que la capa que llama la reescriba.
 */
export function resolveActivePlayer(
  players: FollowedPlayer[],
  cookieValue: string | null | undefined
): { active: FollowedPlayer | null; staleCookie: boolean } {
  if (players.length === 0) {
    return { active: null, staleCookie: false };
  }

  if (cookieValue) {
    const match = players.find((p) => p.playerId === cookieValue);
    if (match) {
      return { active: match, staleCookie: false };
    }
    return { active: players[0]!, staleCookie: true };
  }

  return { active: players[0]!, staleCookie: false };
}
