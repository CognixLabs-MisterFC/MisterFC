/**
 * SU-6b — "he pagado y sigo bloqueado". Acepta bearer (nativa) y cookie (web).
 *
 * Orden INVIOLABLE, el mismo de BC-3 (autentica → el efecto después):
 *   1. `resolveUserFromRequest` valida la sesión → 401. No hay parámetro de destino: el
 *      perfil sale del token/cookie, así que este endpoint NO puede reclamar la
 *      suscripción de otra persona por más que se manipule la llamada.
 *   2. `claimSubscription` comprueba con service-role que la cuenta no está anonimizada
 *      ni desenganchada, pregunta a RevenueCat por ESE App User ID y escribe por los
 *      mismos puntos comunes que el webhook y la reconciliación.
 *
 * Por qué aquí sí se puede preguntar a RevenueCat, si su `GET /subscribers` CREA el
 * cliente (201): porque pregunta la propia persona por su propia cuenta y la cuenta está
 * viva —comprobado en el paso 2, no supuesto por el hecho de haber sesión—. El 201 pasa
 * a significar solo "esta cuenta nunca compró nada".
 *
 * Y no regala nada: lo único que puede dar acceso es lo que responda RevenueCat. Sin
 * compra, `no_entitlement`; de sandbox, `sandbox`.
 *
 * Respuestas: 200 {ok, outcome} para TODOS los desenlaces de negocio (incluido
 * `too_soon`, que es un cortafuegos, no un error del cliente) · 401 · 500 si el fallo es
 * nuestro. El cliente solo necesita saber si volver a mirar su estado.
 */

import { NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { claimSubscription } from '@/lib/subscription';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await claimSubscription(auth.user.id);
  if (!res.ok) return NextResponse.json({ error: 'claim_failed' }, { status: 500 });

  return NextResponse.json({ ok: true, outcome: res.outcome });
}
