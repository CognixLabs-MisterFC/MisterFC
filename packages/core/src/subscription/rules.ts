/**
 * SU-2 — la REGLA de la suscripción, pura y sin cliente.
 *
 * La AUTORIDAD es el SQL (`requires_subscription` y `my_subscription_status`, migración
 * `20261063000000`). Esto es un ESPEJO, y existe por un motivo concreto: la nativa cachea
 * el estado (SWR) y el acceso depende de una FECHA. Sin poder recalcular en local, una
 * suscripción que vence con la app abierta seguiría dando acceso hasta el siguiente
 * refresco. El gate necesita poder responder sin ida y vuelta.
 *
 * Espejo significa que puede DERIVAR del SQL, así que:
 *  · `STAFF_ROLES` se importa de `auth/roles`, no se reescribe — y hay un test que lo
 *    compara con la lista del CHECK de la migración, escrita a mano.
 *  · los casos de `subscriptionStateFrom` son los mismos que cubre el pgTAP de SU-1.
 *
 * Decisión de fondo: ADR-0022. Precio 3 €/año, por CUENTA y no por club.
 */

import type { Role } from '../auth/current-user';
import { STAFF_ROLES } from '../auth/roles';

/** Vínculos de una cuenta, tal y como los mira `requires_subscription` en SQL. */
export type SubscriptionLinks = {
  /** Superadmin de plataforma: nunca paga. */
  isPlatformAdmin: boolean;
  /** Roles de club con la membership VIVA (`left_at is null`). Una baja no cuenta. */
  activeRoles: readonly Role[];
  /** Tutor de algún jugador (`player_accounts`). */
  isTutor: boolean;
  /** Seguidor (`player_spectators` o `team_follows`). */
  isSpectator: boolean;
};

/**
 * ¿Esta cuenta tiene que pagar?
 *
 * Decisión 2 de Jose, confirmada el 2026-09-11: **el staff GANA**. Un entrenador que
 * además es padre NO paga. Es lo coherente con "la suscripción es por CUENTA, no por
 * club": una misma cuenta no puede ser a la vez gratuita y de pago.
 *
 * Quien no tiene ningún vínculo familiar tampoco paga: no hay nada que cobrarle.
 */
export function requiresSubscription(links: SubscriptionLinks): boolean {
  if (links.isPlatformAdmin) return false;
  if (links.activeRoles.some((r) => STAFF_ROLES.includes(r))) return false;
  return links.isTutor || links.isSpectator || links.activeRoles.includes('jugador');
}

/**
 * Hasta cuándo hay acceso. Es el **MÁXIMO**, igual que la columna generada
 * `subscription_entitlements.access_until`.
 *
 * Por qué el máximo y no el mínimo: `expiration_at_ms` y `grace_period_expiration_at_ms`
 * son campos DISTINTOS del webhook de RevenueCat, y el segundo solo viaja en
 * `BILLING_ISSUE`. En un impago el primero es el vencimiento que YA pasó, así que con el
 * mínimo la gracia no daría ni un día de acceso — lo contrario de la decisión de Jose
 * (revisión de ADR-0022 del 2026-09-11). Además el máximo falla del lado benigno: deja
 * pasar a quien sí ha pagado si algo no limpió la gracia.
 *
 * `null` = nunca hubo acceso.
 */
export function accessUntil(
  expiresAt: string | null,
  gracePeriodExpiresAt: string | null,
): string | null {
  if (!expiresAt) return gracePeriodExpiresAt;
  if (!gracePeriodExpiresAt) return expiresAt;
  return Date.parse(gracePeriodExpiresAt) > Date.parse(expiresAt)
    ? gracePeriodExpiresAt
    : expiresAt;
}

/**
 * `staff_free` no paga · `active` al día · `grace` impago abierto pero DENTRO de la
 * gracia de la tienda, **con acceso** · `expired` fuera · `none` nunca hubo ·
 * `unlinked` cuenta borrada.
 */
export type SubscriptionState =
  | 'staff_free'
  | 'active'
  | 'grace'
  | 'expired'
  | 'none'
  | 'unlinked';

/** Los hechos que guarda `subscription_entitlements`, sin interpretar. */
export type EntitlementFacts = {
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  billingIssueDetectedAt: string | null;
  unlinkedAt: string | null;
};

export type SubscriptionStatus = {
  requiresSubscription: boolean;
  hasAccess: boolean;
  state: SubscriptionState;
  accessUntil: string | null;
  billingIssue: boolean;
};

/**
 * El mismo árbol que `my_subscription_status()` en SQL, para poder recalcularlo en local
 * cuando pasa el tiempo. `facts = null` significa que la cuenta no tiene fila todavía.
 *
 * `now` se inyecta para poder probar el vencimiento sin relojes falsos.
 */
export function subscriptionStateFrom(
  links: Pick<SubscriptionStatus, 'requiresSubscription'>,
  facts: EntitlementFacts | null,
  now: Date = new Date(),
): SubscriptionStatus {
  if (!links.requiresSubscription) {
    return {
      requiresSubscription: false,
      hasAccess: true,
      state: 'staff_free',
      accessUntil: null,
      billingIssue: false,
    };
  }

  if (!facts) {
    return {
      requiresSubscription: true,
      hasAccess: false,
      state: 'none',
      accessUntil: null,
      billingIssue: false,
    };
  }

  // El desenganche del borrado de cuenta gana sobre cualquier fecha: es el antídoto
  // contra la resurrección (ADR-0022 §4), no un estado de pago.
  if (facts.unlinkedAt) {
    return {
      requiresSubscription: true,
      hasAccess: false,
      state: 'unlinked',
      accessUntil: null,
      billingIssue: false,
    };
  }

  const until = accessUntil(facts.expiresAt, facts.gracePeriodExpiresAt);
  const billingIssue = facts.billingIssueDetectedAt !== null;

  if (!until || Date.parse(until) <= now.getTime()) {
    return {
      requiresSubscription: true,
      hasAccess: false,
      state: 'expired',
      accessUntil: until,
      billingIssue,
    };
  }

  return {
    requiresSubscription: true,
    hasAccess: true,
    state: billingIssue ? 'grace' : 'active',
    accessUntil: until,
    billingIssue,
  };
}

/**
 * Vuelve a decidir el acceso con el reloj de AHORA, a partir del estado que ya resolvió
 * el servidor. Es lo que consume la app: `my_subscription_status()` devuelve
 * `access_until` YA resuelto, así que aquí no se vuelven a mezclar fechas — solo se
 * comprueba si esa fecha sigue en el futuro.
 *
 * Existe porque el estado se cachea y el acceso depende de una fecha: sin esto, una
 * suscripción que vence con la app abierta seguiría dando acceso hasta el siguiente
 * refresco. Lo que NO hace es abrir nada que el servidor haya cerrado; solo puede
 * cerrar.
 */
export function applyClock(status: SubscriptionStatus, now: Date = new Date()): SubscriptionStatus {
  // No paga: no hay fecha que vigilar.
  if (!status.requiresSubscription) return status;
  // Estados ya cerrados por el servidor. `unlinked` es el desenganche del borrado de
  // cuenta y no se reabre por nada (ADR-0022 §4).
  if (!status.hasAccess) return status;

  const open =
    status.accessUntil !== null && Date.parse(status.accessUntil) > now.getTime();
  if (open) return status;

  return { ...status, hasAccess: false, state: 'expired' };
}
