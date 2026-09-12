/**
 * SU-5 — la DECISIÓN del gate de suscripción, sin cliente de Sentry ni variables de
 * entorno. Vive en core y no en `apps/web` por el motivo de siempre: **`apps/web` no
 * tiene runner de tests**, y esto es una cadena de cuatro condiciones donde equivocarse
 * significa o muro a quien ha pagado o app gratis a quien no.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getMySubscriptionStatusFromClient } from './reads';
import { applyClock } from './rules';
import type { SubscriptionStatus } from './rules';

type DbClient = SupabaseClient<Database>;

export type SubscriptionGateDecision =
  /** Se puede seguir. `status` es null si no se llegó a preguntar o no se pudo leer. */
  | { blocked: false; status: SubscriptionStatus | null; reason: GatePassReason }
  /** Hay que enseñar el muro. */
  | { blocked: true; status: SubscriptionStatus };

export type GatePassReason =
  /** El interruptor de despliegue está apagado. */
  | 'gate_off'
  /** No se pudo leer el estado. NO es "no tiene": se deja pasar y se avisa. */
  | 'unreadable'
  /** No paga: staff, coordinación, dirección o superadmin. */
  | 'not_required'
  /** Paga y está al día (o dentro de la gracia de la tienda). */
  | 'has_access';

export type GateDeps = {
  /** `SUBSCRIPTION_GATE === 'on'` en la web; el flag equivalente en cada runtime. */
  enabled: boolean;
  /** Se llama SOLO cuando la lectura falla. El caller decide si alerta. */
  onUnreadable?: (raw: unknown) => void;
};

/**
 * ¿Se le deja pasar?
 *
 * Tres cosas NO bloquean, y las tres a propósito:
 *  · el gate apagado — es el interruptor de despliegue (se envía apagado);
 *  · una lectura fallida — pondría el muro a una familia que ha pagado por un fallo de
 *    red. Mismo criterio que el resto del paquete: "no se pudo leer" NO es "no tiene";
 *  · quien no paga.
 *
 * `applyClock` se vuelve a aplicar aunque el SQL ya resolvió `access_until`: cuesta
 * nada y cierra la ventana entre que el servidor calculó y este render ocurre.
 */
export async function evaluateSubscriptionGateFromClient(
  supabase: DbClient,
  deps: GateDeps,
): Promise<SubscriptionGateDecision> {
  if (!deps.enabled) return { blocked: false, status: null, reason: 'gate_off' };

  const res = await getMySubscriptionStatusFromClient(supabase);
  if (!res.ok) {
    deps.onUnreadable?.(res.raw);
    return { blocked: false, status: null, reason: 'unreadable' };
  }

  const status = applyClock(res.status);
  if (!status.requiresSubscription) return { blocked: false, status, reason: 'not_required' };
  if (status.hasAccess) return { blocked: false, status, reason: 'has_access' };
  return { blocked: true, status };
}
