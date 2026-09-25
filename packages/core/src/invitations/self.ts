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
  /** `jugador`, `spectator`, o uno de los roles de club. */
  role: string | null;
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
 * `true` si esta invitación convierte a quien acepta en TUTOR del jugador, que es
 * lo único que le da derecho —y obligación— de decidir por él.
 *
 * Es el espejo EXACTO de la condición que usa `accept_pending_invitations` para
 * meter al jugador en el lote (`v_batch_players`):
 *
 *   if v_inv.role = 'jugador' and v_inv.player_id is not null
 *      and v_inv.player_relation is distinct from 'self' then
 *
 * Lo de mirar el ROL y no solo la relación no es defensa de más: la constraint
 * `invitations_player_role_consistency` deja `player_id` no nulo en DOS casos, no
 * en uno — `role='jugador'` con relación, y `role='spectator'` SIN relación. Un
 * filtro que solo descartase `self` se queda al seguidor dentro.
 */
export function needsTutorConsent(row: RelationCarrier): boolean {
  return row.role === 'jugador' && row.player_id != null && !isSelfInvitation(row);
}

/**
 * Las invitaciones del lote que SÍ piden tarjeta de hijo.
 *
 * Un mismo lote puede llevar varias cosas a la vez —un padre que es tutor de su
 * hija, jugador adulto de su propia ficha y seguidor de un sobrino— y por eso esto
 * filtra fila a fila en vez de decidir por el lote entero.
 *
 * Quedan FUERA la cuenta propia del jugador (MN-5) y la invitación de SEGUIDOR: al
 * abuelo que sigue a su nieto no se le piden las decisiones que toma el tutor, ni
 * se le enseña la ficha del menor para que las tome. La rama de seguidor de la RPC
 * crea `player_spectators` y nada más; si la pantalla le pidiera esos datos, el
 * alta ENTERA se caía con `player_not_in_batch`, que ni siquiera tiene mapeo
 * propio: el seguidor veía un error genérico y no podía entrar de ninguna manera.
 */
export function childrenNeedingConsent<T extends RelationCarrier>(
  rows: readonly T[],
): T[] {
  return rows.filter(needsTutorConsent);
}

/**
 * D-2 — los vínculos de tutor que este lote va a crear, por `player_id` y sin repetidos.
 *
 * Es la lista a la que se le pega la DECLARACIÓN de mayoría de edad después de aceptar:
 * si la casilla se pidió por estos hijos, la prueba va en estos vínculos y en ninguno
 * más. Sale de `childrenNeedingConsent` a propósito, y no de una condición nueva: es la
 * MISMA regla que decide si la casilla es obligatoria (`ensureAdultDeclaration`). Dos
 * listas distintas para lo mismo acabarían pidiendo una declaración que no se guarda, o
 * guardándola donde no se pidió.
 *
 * SIN REPETIDOS, y no es cosmético: quien escribe compara cuántas filas ha anotado con
 * cuántas esperaba, y un `player_id` duplicado en el lote haría que esa cuenta no
 * cuadrara nunca y avisara de un fallo que no existe.
 *
 * Fuera quedan, por herencia de `needsTutorConsent`: la cuenta propia del jugador —en un
 * `self` la declaración no significa nada y el CHECK de la 20261109000000 la rechaza— y
 * la invitación de SEGUIDOR, que no crea vínculo de tutor.
 */
export function tutorLinkPlayerIds(rows: readonly RelationCarrier[]): string[] {
  const ids = childrenNeedingConsent(rows)
    .map((r) => r.player_id)
    .filter((id): id is string => id != null);
  return [...new Set(ids)];
}
