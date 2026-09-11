/**
 * SU-3 — Webhook de RevenueCat. Un solo endpoint para las dos tiendas: ese es medio
 * motivo de usar RevenueCat (ADR-0022).
 *
 * Autenticación por firma HMAC-SHA256, no por secreto en la URL:
 * `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>`, calculada sobre
 * `"<t>." + CUERPO CRUDO`. Por eso aquí se lee `arrayBuffer()` y NO `json()`: un
 * `JSON.parse` + `JSON.stringify` cambia los bytes y tumbaría firmas válidas.
 *
 * Códigos de respuesta, que aquí no son cosmética: RevenueCat reintenta hasta 5 veces
 * (5, 10, 20, 40 y 80 minutos) y después DEJA de intentarlo para siempre. Así que un
 * 5xx solo se devuelve cuando el fallo es nuestro y reintentar puede arreglarlo.
 *   · 200 — procesado (aunque el evento no se haya aplicado: sandbox, duplicado,
 *           más viejo, o de una cuenta borrada; todo eso es funcionamiento normal)
 *   · 400 — el cuerpo no es un webhook de RevenueCat. Reintentar no lo va a arreglar.
 *   · 401 — firma ausente, mal formada, vieja o incorrecta.
 *   · 500 — fallamos NOSOTROS. Que lo reintenten.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { SIGNATURE_HEADER } from '@misterfc/core';
import { handleRevenueCatWebhook } from '@/lib/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const raw = new Uint8Array(await req.arrayBuffer());
    const result = await handleRevenueCatWebhook(raw, req.headers.get(SIGNATURE_HEADER));

    if (result.status === 200) {
      return NextResponse.json({ ok: true, outcome: result.outcome });
    }
    return NextResponse.json({ error: errorFor(result.status) }, { status: result.status });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'subscription', step: 'webhook_route' } });
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
