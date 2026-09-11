import 'server-only';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  ingestRevenueCatEvent,
  parseRevenueCatEvent,
  severityFor,
  sweepRevenueCatDeletionsFromClient,
  verifyRevenueCatSignature,
  type DeletionSweepResult,
  type IngestOutcome,
  type RevenueCatConfig,
  type SubscriptionLogger,
} from '@misterfc/core';

/**
 * SU-3 — wrapper web de la suscripción. Único punto que inyecta los secretos:
 * la *signing secret* del webhook y la *secret key* de la API de RevenueCat.
 *
 * Ninguna de las dos puede salir de aquí hacia el cliente: son de servidor y `server-only`
 * hace que el build se rompa si alguien importa esto desde un componente de cliente.
 */

const logSubscription: SubscriptionLogger = (error, step, extra) => {
  console.error(`[subscription] ${step}`, { ...extra, error });
  Sentry.captureException(error, { tags: { feature: 'subscription', step }, extra });
};

function revenueCatConfig(): RevenueCatConfig | null {
  const secretKey = process.env.REVENUECAT_SECRET_KEY;
  return secretKey ? { secretKey } : null;
}

export type WebhookHandling =
  | { status: 401 }
  | { status: 400 }
  | { status: 500 }
  | { status: 200; outcome: IngestOutcome };

/**
 * Verifica, parsea e ingiere. Devuelve el código HTTP que le toca a RevenueCat.
 *
 * Regla de reintentos: **solo se pide reintento cuando el fallo es NUESTRO** (500). Un
 * evento registrado pero no aplicado es procesamiento correcto y se responde 200; si no,
 * reintentarían 5 veces algo que funciona y se quedarían sin reintentos para el día que
 * de verdad estemos caídos.
 */
export async function handleRevenueCatWebhook(
  rawBody: Uint8Array,
  signatureHeader: string | null,
): Promise<WebhookHandling> {
  const signingSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!signingSecret) {
    // Falla CERRADO: sin secreto configurado no se ingiere nada. Un webhook sin
    // verificar puede regalar acceso de pago a quien sepa la URL.
    logSubscription(new Error('REVENUECAT_WEBHOOK_SECRET sin configurar'), 'webhook_no_secret');
    return { status: 401 };
  }

  const check = await verifyRevenueCatSignature(rawBody, signatureHeader, signingSecret);
  if (!check.ok) {
    // `mismatch` con secreto puesto es lo único que huele a intento real; el resto son
    // cabeceras mal formadas o entregas viejas. Ninguno pasa, pero solo uno alerta.
    if (check.reason === 'mismatch') {
      Sentry.captureMessage('subscription: firma de webhook inválida', {
        level: 'warning',
        tags: { feature: 'subscription', step: 'webhook_signature' },
      });
    }
    return { status: 401 };
  }

  const event = parseRevenueCatEvent(rawBody);
  if (!event) return { status: 400 };

  const result = await ingestRevenueCatEvent(createSupabaseAdminClient(), event);
  if (!result.ok) {
    logSubscription(result.raw, 'webhook_ingest', { eventId: event.id, type: event.type });
    return { status: 500 };
  }

  reportOutcome(event.id, event.type, event.appUserId, result.outcome);
  return { status: 200, outcome: result.outcome };
}

/**
 * El bloque que más importa de esta serie.
 *
 * `deleted_profile` NO es un error y NO alerta: las renovaciones y los reembolsos van a
 * seguir llegando durante meses para cuentas ya anonimizadas (BC.0 §8.4). Se registra en
 * `subscription_events` y se responde 200. El SQL ya garantiza que no crea perfil, no
 * enlaza `profile_id` y no toca el entitlement.
 *
 * `transfer_to_deleted_profile` SÍ: una compra que aterriza en una cuenta borrada es el
 * incidente de privacidad que ADR-0022 §4d existe para cazar.
 */
function reportOutcome(
  eventId: string,
  type: string,
  appUserId: string,
  outcome: IngestOutcome,
): void {
  const severity = severityFor(outcome);
  if (severity === 'normal') return;

  Sentry.captureMessage(
    severity === 'alert'
      ? 'subscription: una compra ha intentado aterrizar en una cuenta BORRADA'
      : `subscription: evento no aplicado (${outcome})`,
    {
      level: severity === 'alert' ? 'error' : 'warning',
      tags: { feature: 'subscription', step: 'webhook_outcome', outcome },
      // `appUserId` es nuestro `profiles.id`: un UUID opaco, sin PII (ADR-0022 §3).
      extra: { eventId, type, appUserId, outcome },
    },
  );
}

/**
 * SU-3 — drenado de la cola de borrados en RevenueCat. Pasada 3 del cron de borrado de
 * cuenta: la cola la llena `finalize_account_deletion`, así que es el mismo dominio y el
 * mismo horario.
 */
export async function sweepRevenueCatDeletions(): Promise<DeletionSweepResult> {
  const config = revenueCatConfig();
  if (!config) {
    logSubscription(
      new Error('REVENUECAT_SECRET_KEY sin configurar'),
      'deletion_sweep_no_key',
    );
    return { found: 0, attempted: 0, succeeded: 0, failed: 0, stuck: 0 };
  }
  return sweepRevenueCatDeletionsFromClient(createSupabaseAdminClient(), config, {
    logError: logSubscription,
  });
}
