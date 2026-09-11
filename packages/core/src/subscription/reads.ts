/**
 * SU-2 — LECTURA del estado de suscripción.
 *
 * Una sola RPC, `my_subscription_status()`, SECURITY DEFINER con `auth.uid()` CABLEADO en
 * el SQL: no hay parámetro de destino, así que no puede devolver el estado de otra
 * persona por mucho que se manipule la llamada.
 *
 * POR QUÉ PROPAGA EL ERROR en vez de devolver vacío (mismo criterio que las lecturas de
 * BC-2): una lectura muda aquí no enseña "menos datos", enseña **la pantalla
 * equivocada**, y en las dos direcciones.
 *  · si falla y devolviéramos "sin acceso", una familia que ha pagado se come el muro de
 *    pago por un error de red;
 *  · si falla y devolviéramos "con acceso", el muro no existe.
 * Ninguna de las dos es aceptable, así que el caller TIENE que poder distinguir "no
 * tiene suscripción" de "no se pudo leer" y decidir (SU-4/SU-5: reintento y aviso, nunca
 * un gate silencioso).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { SubscriptionState, SubscriptionStatus } from './rules';

type DbClient = SupabaseClient<Database>;

export type SubscriptionStatusResult =
  | { ok: true; status: SubscriptionStatus }
  | { ok: false; raw: unknown };

const STATES: readonly SubscriptionState[] = [
  'staff_free',
  'active',
  'grace',
  'expired',
  'none',
  'unlinked',
];

function toState(raw: string): SubscriptionState {
  // Un estado que no conocemos NO puede abrir la puerta: se trata como `none`, que es el
  // caso cerrado. Pasaría si el SQL añadiera un estado y el cliente fuera viejo.
  return (STATES as readonly string[]).includes(raw) ? (raw as SubscriptionState) : 'none';
}

/**
 * `my_subscription_status()` — devuelve exactamente una fila para cualquier sesión
 * válida. Cero filas solo puede significar que algo fue mal, así que es un error, no un
 * "no tiene".
 */
export async function getMySubscriptionStatusFromClient(
  supabase: DbClient,
): Promise<SubscriptionStatusResult> {
  const { data, error } = await supabase.rpc('my_subscription_status');
  if (error) return { ok: false, raw: error };

  const row = data?.[0];
  if (!row) {
    return { ok: false, raw: new Error('my_subscription_status sin fila') };
  }

  const state = toState(row.state);
  return {
    ok: true,
    status: {
      requiresSubscription: row.requires_subscription,
      // `has_access` lo decide el SQL; si el estado no lo reconocemos, no se abre.
      hasAccess: state === 'none' && row.state !== 'none' ? false : row.has_access,
      state,
      accessUntil: row.access_until,
      billingIssue: row.billing_issue,
    },
  };
}
