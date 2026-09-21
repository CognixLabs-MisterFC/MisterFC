/**
 * Correo-B · el correo de restablecer contraseña, para la app.
 *
 * La app nativa no puede mandarlo ella: el correo sale por Resend y eso exige la
 * service-role key, que en un móvil no puede vivir. Así que lo pide aquí, igual que
 * `/api/invitations/self-accept`.
 *
 * ES PÚBLICO, Y NO PUEDE NO SERLO: quien ha perdido la contraseña no tiene sesión.
 * Esa es toda la razón de que exista el contador del #673 — sin él, esto sería un
 * botón para mandar correos a cualquier dirección a nuestra costa. El límite va
 * dentro de `enviarCorreoRecuperacion`, ANTES de buscar la cuenta y antes de hablar
 * con GoTrue, y falla cerrado.
 *
 * ── LO QUE ESTE ENDPOINT NO DEJA DECIDIR AL CLIENTE ────────────────────────
 *
 * A DÓNDE LLEVA EL ENLACE. El destino se construye aquí, con el host de ESTA
 * petición, y no con nada que mande la app. Hasta ahora lo ponía la app desde su
 * `webBaseUrl()`, que era razonable cuando el que hablaba con GoTrue era el propio
 * móvil; en un endpoint público no lo es: un destino que viaja en el cuerpo es un
 * destino que cualquiera puede cambiar. GoTrue lo filtraría con su lista de
 * permitidos, pero eso es una lista de configuración que vive fuera del repo — no un
 * sitio donde apoyar la seguridad de un enlace que abre sesión.
 *
 * El `locale` del cuerpo SÍ se acepta, y no es lo mismo: solo se usa como respaldo
 * cuando el destinatario no tiene idioma en su perfil. No decide dónde aterriza
 * nadie, solo en qué idioma se le escribe.
 *
 * ── QUÉ CONTESTA, Y QUÉ CALLA ─────────────────────────────────────────────
 *
 * 200 tanto si se mandó como si ese correo no tiene cuenta. Son indistinguibles a
 * propósito: si no lo fueran, esto sería un oráculo para saber quién está registrado
 * en MisterFC — y basta con ir probando direcciones.
 *
 * El 429 sí se ve, y no es una fuga: el contador se indexa por correo exista o no la
 * cuenta, así que verlo no dice nada de si hay alguien detrás. Callarlo sería peor:
 * quien ha pulsado cinco veces se quedaría mirando «revisa tu correo» sin que llegue
 * nada.
 *
 * El 500 de un envío que falla de verdad es la única grieta —solo puede fallar el
 * envío de una cuenta que existe— y se acepta por lo mismo que en la web: mentirle a
 * quien sí tiene cuenta y no va a recibir nada es peor que una señal que hay que
 * provocar para leer, y que la regla de enumeración del contador ya frena.
 *
 * Respuestas: 200 {ok:true} · 400 invalid_email · 429 rate_limited + Retry-After ·
 * 503 unavailable · 500 generic.
 */

import { NextResponse } from 'next/server';
import { forgotPasswordSchema } from '@misterfc/core';
import { clientIpFrom } from '@/lib/client-ip';
import { enviarCorreoRecuperacion } from '@/lib/email/password-recovery';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_email', 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const parsed = forgotPasswordSchema.safeParse({ email: b.email });
  if (!parsed.success) return fail('invalid_email', 400);

  const locale = typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';

  const resultado = await enviarCorreoRecuperacion({
    email: parsed.data.email,
    locale,
    ip: clientIpFrom(req.headers),
    baseUrl: `${proto}://${host}`,
  });

  switch (resultado.estado) {
    case 'limitado':
      return fail('rate_limited', 429, {
        'Retry-After': String(resultado.esperaSegundos),
      });
    case 'no_disponible':
      return fail('unavailable', 503);
    case 'fallo':
      return fail('generic', 500);
    default:
      // `enviado` y `sin_cuenta`, idénticos.
      return NextResponse.json({ ok: true });
  }
}
