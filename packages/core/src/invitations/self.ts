/**
 * MN-5 — la invitación de CUENTA PROPIA del jugador, en el alta.
 *
 * Una invitación con `player_relation='self'` la recibe el PROPIO jugador, no su
 * tutor. Eso cambia una sola cosa en la pantalla de alta, pero la cambia entera:
 * el jugador no responde por sí mismo las decisiones de imagen, ni confirma sus
 * datos, ni aporta ficha médica. Todo eso lo decidió su tutor y sigue siendo suyo
 * (decisión 4 de Jose), y desde MN-3 la RPC `accept_pending_invitations` ni
 * siquiera lo acepta: si el formulario mandara esos datos, devolvería
 * `reserved_for_tutor`.
 *
 * Vive en core, y no en la página, por el mismo motivo que `accept-form.ts`: es la
 * regla que decide qué se le pide a quien está dando de alta, y aquí es donde el
 * CI la ejecuta. La página solo la llama.
 */

/** Forma mínima de una invitación del lote pendiente. */
export type RelationCarrier = {
  player_id: string | null;
  player_relation: string | null;
};

/** `true` si la invitación es para la cuenta propia del jugador. */
export function isSelfInvitation(row: RelationCarrier): boolean {
  return row.player_relation === 'self';
}

/** `true` si en el lote pendiente hay alguna invitación de cuenta propia. */
export function hasSelfInvitation(rows: readonly RelationCarrier[]): boolean {
  return rows.some(isSelfInvitation);
}

/**
 * Las invitaciones del lote que SÍ piden tarjeta de hijo: las que van sobre un
 * jugador y NO son la cuenta propia de quien acepta.
 *
 * Un mismo lote puede llevar las dos cosas a la vez —un padre que es tutor de su
 * hija y además jugador adulto de su propia ficha— y por eso esto filtra fila a
 * fila en vez de decidir por el lote entero.
 */
export function childrenNeedingConsent<T extends RelationCarrier>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.player_id != null && !isSelfInvitation(row));
}
