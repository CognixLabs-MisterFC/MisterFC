import 'server-only';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  ingestResendDeliveryEvent,
  parseResendDeliveryEvent,
  verifyResendSignature,
  RESEND_SIGNATURE_HEADERS,
} from '@misterfc/core';

/**
 * A-2 — wrapper web del webhook de Resend. Único punto que toca el secreto de firma;
 * `server-only` hace que el build se rompa si alguien importa esto desde un componente
 * de cliente.
 *
 * Mismo reparto que SU-3: el route handler solo traduce a HTTP y aquí vive la decisión.
 */

export type DeliveryWebhookHandling =
  | { status: 401 }
  | { status: 400 }
  | { status: 500 }
  | { status: 200; outcome: 'applied' | 'unknown_message' | 'ignored' };

/**
 * Verifica, parsea e ingiere. Devuelve el código HTTP que le toca a Resend.
 *
 * Regla de reintentos: **solo se pide reintento cuando el fallo es NUESTRO** (500).
 *   · 200 — procesado. Incluye el evento que no casa con ninguna invitación y el que no
 *           es de entrega: los dos son funcionamiento normal, no hay nada que reintentar.
 *   · 400 — el cuerpo no es JSON. Reintentarlo daría lo mismo.
 *   · 401 — firma ausente, mal formada, vieja o incorrecta.
 *   · 500 — falló la escritura. Que lo reintenten.
 */
export async function handleResendDeliveryWebhook(
  rawBody: Uint8Array,
  headers: Headers,
): Promise<DeliveryWebhookHandling> {
  const signingSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!signingSecret) {
    // Falla CERRADO: sin secreto no se ingiere nada. Un webhook sin verificar deja que
    // cualquiera que sepa la URL marque invitaciones buenas como rebotadas —o, peor,
    // tape un rebote de verdad poniéndolo en `delivered`—.
    logDelivery(new Error('RESEND_WEBHOOK_SECRET sin configurar'), 'webhook_no_secret');
    return { status: 401 };
  }

  const check = await verifyResendSignature(
    rawBody,
    {
      id: headers.get(RESEND_SIGNATURE_HEADERS.id),
      timestamp: headers.get(RESEND_SIGNATURE_HEADERS.timestamp),
      signature: headers.get(RESEND_SIGNATURE_HEADERS.signature),
    },
    signingSecret,
  );
  if (!check.ok) {
    // `mismatch` con secreto puesto es lo único que huele a intento real; el resto son
    // cabeceras mal formadas o entregas viejas. Ninguno pasa, pero solo uno alerta.
    if (check.reason === 'mismatch') {
      Sentry.captureMessage('invitations: firma de webhook de Resend inválida', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'delivery_webhook_signature' },
      });
    }
    return { status: 401 };
  }

  const event = parseResendDeliveryEvent(rawBody);
  // `null` cubre dos cosas distintas y ninguna es culpa de Resend: un evento que no es
  // de entrega (una apertura, un evento de dominio) y un cuerpo ilegible. Se separan
  // porque el segundo sí es raro y merece un 400.
  if (!event) {
    return esJson(rawBody) ? { status: 200, outcome: 'ignored' } : { status: 400 };
  }

  const result = await ingestResendDeliveryEvent(createSupabaseAdminClient(), event);
  if (!result.ok) {
    logDelivery(result.raw, 'delivery_webhook_ingest', {
      message_id: event.messageId,
      state: event.state,
    });
    return { status: 500 };
  }

  // Cero filas es lo NORMAL en esta cuenta: por aquí entran también los correos de
  // recuperación de contraseña y los envíos anteriores a A-2, que no guardaron el id.
  // No alerta: alertar por cada uno convertiría el canal en ruido y acabaría enterrando
  // el rebote de verdad.
  return {
    status: 200,
    outcome: result.rows > 0 ? 'applied' : 'unknown_message',
  };
}

function esJson(rawBody: Uint8Array): boolean {
  try {
    JSON.parse(new TextDecoder().decode(rawBody));
    return true;
  } catch {
    return false;
  }
}

function logDelivery(error: unknown, step: string, extra?: Record<string, unknown>): void {
  console.error(`[invitations] ${step}`, { ...extra, error });
  Sentry.captureException(error, { tags: { feature: 'invitations', step }, extra });
}
