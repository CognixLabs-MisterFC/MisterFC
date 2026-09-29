/**
 * R-5 — ¿de qué tipo es esta invitación? El veredicto del token, ANTES de pedir nada.
 *
 * EL PROBLEMA QUE CIERRA, medido en producción el 2026-09-29 con una invitación de tutor
 * real: la ruta `/{locale}/invite/*` la reclaman las dos tiendas —`autoVerify` en el
 * `app.json` de Android y el `apple-app-site-association` que sirve el dominio—, así que
 * cualquier invitación abierta desde el móvil aterriza en la pantalla nativa. Y esa
 * pantalla atiende SOLO el caso `self`. El veredicto existía —`decideSelfAccept`— pero
 * solo se calculaba dentro del POST y, además, DESPUÉS del `safeParse` del cuerpo: un
 * padre rellenaba nombre, teléfono, contraseña y dos consentimientos para recibir
 * `not_self` al final. La app no podía arreglarlo sola; hacía falta esta puerta.
 *
 * ES UN POST, y no un GET, por tres razones:
 *   · el token no viaja en la URL, así que no entra en logs de acceso ni en cachés
 *     intermedias — la URL de la invitación ya lo lleva por fuerza, la llamada no;
 *   · `callPublicServerEndpoint` (el cliente de la app, R-3) es POST y solo POST;
 *   · un GET podría cachearse y servir un veredicto viejo, que es justo lo que no puede
 *     pasar con un estado de un solo uso.
 *
 * QUÉ COMPARTE CON EL POST DE AL LADO, y esto es lo que lo hace seguro:
 *   · EL MISMO CONTADOR (`register_invite_accept_attempt`, mig 20261074000000), antes de
 *     nada y fallando CERRADO. Sin él esto sería un oráculo de enumeración gratis;
 *   · EL MISMO GATE: `decideInvitePreflight` llama a `decideSelfAccept` y no
 *     reimplementa ninguna condición;
 *   · LOS MISMOS CÓDIGOS y los mismos estados HTTP, para que la app no tenga dos mapeos.
 *
 * LO QUE CUESTA, y es la contrapartida que hay que conocer: abrir la pantalla consume 1
 * de los 10 intentos por token cada 15 minutos. Para una familia que abre su enlace una
 * o dos veces sobra de largo; quien esté PROBANDO el flujo se puede quedar sin huecos y
 * ver un 429 que no es un fallo. El token NO se quema nunca (lo dice la migración), así
 * que la espera es de minutos.
 *
 * NO REVELA NADA NUEVO: el POST ya distinguía 404 `not_found` de 409 `not_self`, y va
 * con el mismo contador delante. Lo que NO sale de aquí es el correo del invitado ni el
 * uid de la cuenta a reclamar: la rama `ok` del gate los lleva y el preflight los tira
 * (`decideInvitePreflight`, con su test que cuenta las claves).
 *
 * Respuestas: 200 {status:'self'} · 400 invalid · 404 not_found · 409 already_accepted,
 * expired, not_self, not_claimable · 429 rate_limited + Retry-After · 503 unavailable.
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, decideInvitePreflight } from '@misterfc/core';
import { clientIpFrom } from '@/lib/client-ip';
import { loadInvitationByToken } from '@/app/[locale]/invite/[token]/invite-data';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid', 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // El token se valida antes del contador, igual que en el POST hermano: el contador se
  // indexa POR token, así que sin token no hay nada que contar.
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!UUID_RE.test(token)) return fail('invalid', 400);

  const admin = createSupabaseAdminClient();

  // ── 1 · El límite, antes que la lectura ─────────────────────────────────
  const { data: limitRows, error: limitErr } = await admin.rpc(
    'register_invite_accept_attempt',
    { p_token: token, p_ip: clientIpFrom(req.headers) ?? undefined },
  );
  if (limitErr) return fail('unavailable', 503);

  const limit = Array.isArray(limitRows) ? limitRows[0] : limitRows;
  if (!limit) return fail('unavailable', 503);

  if (limit.decision !== 'ok') {
    // Idéntica exista o no el token: si distinguiera, el limitador sería el oráculo de
    // enumeración que viene a evitar.
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(limit.retry_after_seconds ?? 60),
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  // ── 2 · El veredicto, el mismo del gate ─────────────────────────────────
  const invitation = await loadInvitationByToken(token);
  const out = decideInvitePreflight(invitation, Date.now());
  // Mismo reparto que el POST hermano hace con los errores del gate: `not_found` es un
  // 404 y los otros cuatro son estados, 409. No hay tabla que mantener — la union de
  // `SelfAcceptRefusal` tiene exactamente esos cinco, y un `Set` aqui seria un adorno
  // con una rama inalcanzable detras.
  if ('error' in out) {
    return fail(out.error, out.error === 'not_found' ? 404 : 409);
  }

  return NextResponse.json(
    { status: out.status },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
