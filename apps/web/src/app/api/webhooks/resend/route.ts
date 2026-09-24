/**
 * A-2 — Webhook de Resend: qué pasó con cada correo de invitación.
 *
 * Autenticación por firma, no por secreto en la URL. Resend delega el firmado en Svix:
 * cabeceras `svix-id`, `svix-timestamp` y `svix-signature`, y el HMAC se calcula sobre
 * `"<id>.<timestamp>." + CUERPO CRUDO`. Por eso aquí se lee `arrayBuffer()` y NO
 * `json()`: un `JSON.parse` + `JSON.stringify` cambia los bytes y tumbaría firmas
 * válidas.
 *
 * Códigos de respuesta:
 *   · 200 — procesado (aunque el evento no case con ninguna invitación, o no sea de
 *           entrega: las dos cosas son funcionamiento normal)
 *   · 400 — el cuerpo no es JSON. Reintentar no lo va a arreglar.
 *   · 401 — firma ausente, mal formada, vieja o incorrecta.
 *   · 500 — fallamos NOSOTROS. Que lo reintenten.
 *
 * DAR DE ALTA: resend.com → Webhooks → Add Webhook, apuntando a
 * `https://misterfc.es/api/webhooks/resend`, y el *signing secret* (`whsec_…`) a
 * `RESEND_WEBHOOK_SECRET` en Vercel. Sin secreto esto responde 401 a todo, que es lo
 * que queremos: fallar cerrado.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { handleResendDeliveryWebhook } from '@/lib/invitation-delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const raw = new Uint8Array(await req.arrayBuffer());
    const result = await handleResendDeliveryWebhook(raw, req.headers);

    if (result.status === 200) {
      return NextResponse.json({ ok: true, outcome: result.outcome });
    }
    return NextResponse.json({ error: errorFor(result.status) }, { status: result.status });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'invitations', step: 'delivery_webhook_route' } });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  } finally {
    // En serverless la función se congela al return: sin esto el evento puede no salir.
    await Sentry.flush(2000);
  }
}

function errorFor(status: 400 | 401 | 500): string {
  if (status === 401) return 'unauthorized';
  if (status === 400) return 'bad_request';
  return 'internal_error';
}
