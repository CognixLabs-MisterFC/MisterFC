import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
  evaluateSubscriptionGateFromClient,
  type Database,
  type SubscriptionGateDecision,
} from '@misterfc/core';

/**
 * SU-5 — envoltorio web del gate de suscripción. Patrón del gate de re-consentimiento
 * de F14-5: se resuelve en el layout con una RPC y se redirige a una pantalla que vive
 * FUERA del grupo de rutas, así que no hay bucle.
 *
 * La DECISIÓN vive en core (`evaluateSubscriptionGateFromClient`), que es donde hay
 * tests; aquí solo se inyecta el interruptor y el aviso a Sentry.
 *
 * ⚠️ SE ENVÍA APAGADO, igual que en la nativa. Solo bloquea si `SUBSCRIPTION_GATE` vale
 * exactamente `'on'`. Son DOS variables y no una porque son dos runtimes distintos
 * —`SUBSCRIPTION_GATE` en Vercel y `EXPO_PUBLIC_SUBSCRIPTION_GATE` en el build de EAS—
 * y **tienen que encenderse juntas**: con solo la web encendida, una familia se queda
 * fuera del navegador y dentro del móvil, que parece una avería y no una decisión.
 */
export const SUBSCRIPTION_GATE_ENABLED = process.env.SUBSCRIPTION_GATE === 'on';

export async function evaluateSubscriptionGate(
  supabase: SupabaseClient<Database>,
): Promise<SubscriptionGateDecision> {
  return evaluateSubscriptionGateFromClient(supabase, {
    enabled: SUBSCRIPTION_GATE_ENABLED,
    onUnreadable: (raw) => {
      Sentry.captureMessage('subscription: no se pudo leer el estado en el gate web', {
        level: 'warning',
        tags: { feature: 'subscription', step: 'gate_web' },
        extra: { raw: String(raw) },
      });
    },
  });
}
