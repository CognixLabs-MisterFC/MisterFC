/**
 * O2-4 PR-1 — Fan-out multi-canal (lógica pura).
 *
 * Una notificación push del user va ahora a DOS transportes: sus suscripciones
 * Web Push (`push_subscriptions`, como hoy) Y sus Expo push tokens
 * (`expo_push_tokens`, nativo). El gate `user_wants_notification(...,'push')` se
 * consulta UNA sola vez (mismo canal 'push'); aquí solo se COMBINAN los
 * resultados de cada canal en un único `SendOutcome`, del que `decideNotification\
 * Outcome` deriva el status de la fila.
 *
 * Aislado y puro para testear el criterio de status con éxito parcial sin red.
 */

import type { SendOutcome } from './push-drain';

/**
 * Resultado de UN canal. `null` = el canal no tenía destinos (sin subs / sin
 * tokens): distinto de `{sent:0,...}` (tenía destinos pero ninguno entregó).
 */
export type ChannelResult = {
  sent: number;
  failed_gone: number;
  failed_other: number;
} | null;

/**
 * Combina web + expo en un `SendOutcome` agregado (criterio O2-4):
 *   - `wants=false` → skipped_user_pref (el gate dijo no; ni se intentó).
 *   - sent = suma de ambos → si CUALQUIER destino entregó, sent>0.
 *   - skipped_no_subscriptions solo si NINGÚN canal tenía destinos (ambos null).
 *
 * El status final lo decide `decideNotificationOutcome(merged)`:
 *   sent>0 → 'sent' · skipped_user_pref → 'skipped' · sin destinos → 'pending' ·
 *   hubo intentos y todos muertos (failed_gone>0, failed_other=0, sent=0) →
 *   'failed' · errores transitorios → 'pending' (retry cron).
 * Así un fallo de Expo NO marca failed algo que llegó por web, ni al revés.
 */
export function mergeChannelOutcomes(
  wants: boolean,
  web: ChannelResult,
  expo: ChannelResult,
): SendOutcome {
  if (!wants) {
    return {
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      skipped_user_pref: true,
      skipped_no_subscriptions: false,
    };
  }
  return {
    sent: (web?.sent ?? 0) + (expo?.sent ?? 0),
    failed_gone: (web?.failed_gone ?? 0) + (expo?.failed_gone ?? 0),
    failed_other: (web?.failed_other ?? 0) + (expo?.failed_other ?? 0),
    skipped_user_pref: false,
    skipped_no_subscriptions: web === null && expo === null,
  };
}
