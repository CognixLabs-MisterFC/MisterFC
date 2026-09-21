/**
 * Qué ES cada invitación pendiente de un jugador.
 *
 * Tres cosas muy distintas comparten `player_id` en `invitations` y hasta ahora
 * se pintaban igual en la ficha del jugador:
 *
 *   · TUTOR            role='jugador'   + player_relation 'parent' | 'guardian'
 *   · CUENTA DEL MENOR role='jugador'   + player_relation 'self'      (MN-2)
 *   · SEGUIDOR         role='spectator' + player_relation NULL        (F14-C)
 *
 * El seguidor no tiene relación, así que la ficha no escribía NADA a su lado: la
 * abuela y el padre se veían igual, y cancelar una por otra es irreversible.
 *
 * Los cuatro casos son exhaustivos por el CHECK `invitations_player_role_consistency`
 * (mig 20261001000000) para toda fila con `player_id`, así que `unknown` hoy es
 * inalcanzable. Se devuelve igualmente: si algún día nace una cuarta clase de
 * invitación con `player_id`, la ficha dirá que no sabe qué es en vez de callarse
 * —que fue el fallo original— o de mentir etiquetándola como seguidor.
 *
 * Vive en core, y no en la página, porque es una regla del modelo de datos y aquí
 * es donde el CI la ejecuta.
 */

/** Forma mínima de una invitación ligada a un jugador. */
export type PlayerInviteRow = {
  role: string | null;
  player_relation: string | null;
};

/** Las clases de invitación que puede llevar un jugador. */
export type PlayerInviteKind =
  | 'parent'
  | 'guardian'
  | 'self'
  | 'spectator'
  | 'unknown';

/**
 * Clasifica POSITIVAMENTE: cada clase exige su rol Y su relación. El seguidor no
 * es «la que no tiene relación» sino `role='spectator'` sin relación; así una
 * fila con una forma que no esperábamos cae en `unknown` en vez de heredar la
 * etiqueta de otra.
 */
export function playerInviteKind(row: PlayerInviteRow): PlayerInviteKind {
  if (row.role === 'spectator' && row.player_relation == null) {
    return 'spectator';
  }
  if (row.role === 'jugador') {
    if (row.player_relation === 'parent') return 'parent';
    if (row.player_relation === 'guardian') return 'guardian';
    if (row.player_relation === 'self') return 'self';
  }
  return 'unknown';
}
