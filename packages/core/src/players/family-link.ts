/**
 * F14 — ¿La familia de un jugador ha entrado en la app?
 *
 * SEÑAL, sin columna nueva: `player_accounts` del jugador. Si está vacío, ninguna
 * familia completó el alta → hoy NO recibe convocatorias ni avisos (los fan-outs
 * de convocatorias/anuncios/mensajes/recordatorios resuelven destinatarios vía
 * `player_accounts`). El marcador solo lo NOMBRA.
 *
 * UN SOLO MARCADOR — "Sin app" (decisión Jose, 2026-09-01). Antes eran dos
 * ("Invitación pendiente" vs "Sin invitar"), lo que obligaba a leer también
 * `invitations`. Se descartó: la RLS de `invitations` solo la deja leer a
 * admin_club/director y al entrenador PRINCIPAL del equipo, así que a un ayudante
 * o a un coordinador el marcador le habría MENTIDO ("Sin invitar" sobre un jugador
 * con invitación pendiente), y ampliar esa policy quedó descartado. Con un solo
 * marcador basta `player_accounts`, que sí lee todo el cuerpo técnico: el dato es
 * el mismo para todos los roles. Y el texto es exacto: la web se retira cuando la
 * app esté lista, así que sin familia vinculada = sin app.
 *
 * SOLO PRESENTACIÓN: nada gatea convocatoria/asistencia/estadísticas por esto. Un
 * jugador "Sin app" se convoca, se le pasa lista y se le llevan stats igual que
 * uno con familia. El importador (#543) usa esta misma regla, pero para ENLAZAR,
 * no para pintar.
 */

/**
 * Las relaciones que son TUTOR. `player_accounts.relation` admite tres valores
 * (`self | parent | guardian`, CHECK de la tabla) y solo dos son un tutor: la
 * tercera es la CUENTA DEL PROPIO MENOR (serie MN).
 *
 * Se declara en positivo, no como «todo menos self», para que un cuarto valor no
 * entre solo en la lista de la familia: entrar hay que pedirlo.
 *
 * Quien pinta la FAMILIA de un jugador usa esto. Quien cuenta si hay app
 * instalada, NO: ver `hasLinkedFamily` justo debajo.
 */
export const TUTOR_RELATIONS = ['parent', 'guardian'] as const;

/** ¿Esta fila de `player_accounts` es la de un tutor, y no la del propio menor? */
export function isTutorAccount(row: { relation: string | null }): boolean {
  return (TUTOR_RELATIONS as readonly string[]).includes(row.relation ?? '');
}

/**
 * ¿Alguna familia completó el alta? (basta con que exista alguna player_account).
 *
 * MIRA TODAS LAS FILAS, la del propio menor incluida, y por eso no usa
 * `isTutorAccount`: un menor con cuenta propia y sin tutores vinculados TIENE la
 * app. Filtrar aquí lo marcaría «Sin app», que es justo lo contrario de la verdad.
 */
export function hasLinkedFamily(
  accounts: ReadonlyArray<unknown> | null | undefined,
): boolean {
  return (accounts?.length ?? 0) > 0;
}
