/**
 * W-A — ¿esta cuenta usa la APP, o sigue usando la WEB?
 *
 * Decisión de Jose: cuando la app esté publicada, las familias dejan de usar la web.
 * El staff y la dirección siguen igual. Lo que queda abierto para todos es el alta por
 * invitación (`/invite/{token}`), los textos legales, la eliminación de cuenta y —por
 * la excepción del punto 2 de la ronda de respuestas— el re-consentimiento de temporada,
 * que HOY SOLO EXISTE EN LA WEB (`tutor_needs_reconsent` / `record_season_reconsent` no
 * aparecen en `apps/native`).
 *
 * ── POR QUÉ ESTO NO ES UN ALIAS DE `requiresSubscription` ────────────────────────────
 *
 * Hoy los dos conjuntos coinciden exactamente, y hay un test que lo comprueba sobre las
 * 512 combinaciones posibles (64 subconjuntos de los 6 roles × superadmin × tutor ×
 * seguidor) en vez de suponerlo. Pero son DOS PREGUNTAS DISTINTAS:
 *
 *   · `requiresSubscription` (SU-2) responde «¿a quién se le cobra?»
 *   · `isFamilyAccount` responde «¿quién ha dejado de usar el navegador?»
 *
 * Coinciden por accidente histórico: hasta hoy, pagar y ser familia han sido lo mismo.
 * El día que Jose decida que un delegado paga, o que una categoría concreta siga en la
 * web, las dos se separan — y si esto fuera un alias, la separación ocurriría en
 * silencio y en la dirección equivocada (alguien pierde el navegador porque se cambió
 * una regla de facturación). Escribiéndolas por separado, ese día el test de contrato
 * se pone rojo y OBLIGA a decidir cuál de las dos cambia.
 *
 * Es el mismo criterio con el que `subscription/rules.ts` deriva `STAFF_ROLES` de
 * `auth/roles` en vez de reescribirlos: una sola fuente para los datos, predicados
 * separados para las preguntas separadas.
 *
 * ── LA AUTORIDAD ─────────────────────────────────────────────────────────────────────
 *
 * Que "familia" no sea un rol no es una interpretación mía: está escrito en la migración
 * `20260822000000`, en el comment de `memberships.role`:
 *
 *     «6 roles. […] "familia" no es un rol: cuenta familia = profile con rol "jugador"
 *      vinculado vía player_accounts.»
 *
 * Los 6 roles son los 5 de staff más `jugador`. No hay un séptimo donde esconderse.
 */

import type { Role } from '../auth/current-user';
import { STAFF_ROLES } from '../auth/roles';

/**
 * Los vínculos de una cuenta. Mismos hechos que mira `requires_subscription` en SQL
 * —y por eso son estructuralmente intercambiables con `SubscriptionLinks`— pero
 * declarados aquí para que este módulo pueda cambiar sin arrastrar al otro.
 */
export type AccountLinks = {
  /** Superadmin de plataforma (`platform_admins`). */
  isPlatformAdmin: boolean;
  /** Roles de club con la membership VIVA (`left_at is null`). Una baja no cuenta. */
  activeRoles: readonly Role[];
  /** Tutor de algún jugador (`player_accounts`). */
  isTutor: boolean;
  /** Seguidor de un jugador o de un equipo (`player_spectators` / `team_follows`). */
  isSpectator: boolean;
};

/**
 * ¿Es una cuenta de las que, con el interruptor puesto, pasan a usar solo la app?
 *
 * Tres cláusulas, y cada una tiene su propio motivo:
 *
 *  1. **Superadmin de plataforma: no.** La consola (`/platform`) solo existe en la web;
 *     cerrarle el navegador le dejaría sin herramienta.
 *  2. **Staff con membership viva: no.** «NO afecta a staff ni a dirección: siguen
 *     usando la web igual». Y el staff GANA sobre el vínculo familiar, igual que en
 *     SU-2: un entrenador que además es padre conserva la web. Que la misma cuenta
 *     estuviera dentro por un lado y fuera por otro no es un estado que se pueda pintar.
 *  3. **Tutor, seguidor o rol `jugador`: sí.** Los seguidores entran por decisión
 *     expresa de Jose (punto 1 de la ronda de respuestas): la nativa tiene su carcasa de
 *     seguidor completa, así que no se quedan sin sitio a donde ir.
 *
 * Y una cuarta, que es la ausencia de las otras: **una cuenta sin ningún vínculo NO es
 * familia**. Hoy no puede ocurrir —dentro del árbol autenticado hace falta una
 * membership, y los 6 roles están cubiertos por (2) y (3)— pero si ocurriera, la
 * dirección benigna es dejarle la web: este corte no protege nada, así que equivocarse
 * hacia abierto no abre ninguna puerta.
 */
export function isFamilyAccount(links: AccountLinks): boolean {
  if (links.isPlatformAdmin) return false;
  if (links.activeRoles.some((r) => STAFF_ROLES.includes(r))) return false;
  return links.isTutor || links.isSpectator || links.activeRoles.includes('jugador');
}
