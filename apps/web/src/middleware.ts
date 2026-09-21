import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import * as Sentry from '@sentry/nextjs';
import { requiresPasswordChange, localeFromPath } from '@misterfc/core';
import { routing } from './i18n/routing';

const handleIntl = createIntlMiddleware(routing);

/**
 * Middleware combinado:
 *
 *   1. Si llega un `?code=` (PKCE) o `?token_hash=&type=` (OTP) suelto en la
 *      URL (típicamente porque Supabase Auth redirigió aquí tras verificar un
 *      email), lo enrutamos a `/auth/callback` para que se intercambie por
 *      sesión antes de servir la página. Esto es una red de seguridad: aunque
 *      el redirectTo de la action apunte directamente a /invite/{token}, si
 *      Supabase termina cayendo en otra ruta por allowlist, igualmente
 *      establecemos sesión.
 *
 *   2. Refresca la sesión Supabase leyendo/escribiendo cookies sobre el
 *      response. Sin esto, los tokens caducan en el browser pero no se
 *      refrescan en server-side y los Server Components ven al user como
 *      desconectado.
 *
 *   3. Aplica el routing i18n de next-intl (prefijo de locale).
 *
 *   4. EL CANDADO DE LA CONTRASEÑA: quien llega por el enlace de recuperación
 *      no navega a ningún sitio hasta fijar una nueva.
 *
 * Los redirects de auth NO viven aquí por norma —cada página decide con
 * `getCurrentUser()`, y así no hay doble lógica de protección—, pero el candado
 * es la segunda excepción (la primera es la portada de clubes). El motivo es que
 * la regla es «CUALQUIER página», públicas incluidas, y los tres guards que ya
 * existen (suscripción, re-consentimiento, corte de familia web) viven en el
 * layout autenticado y por definición no llegan ahí. No cuesta una ida y vuelta
 * extra: el `getUser()` de abajo ya estaba.
 */
export default async function middleware(request: NextRequest) {
  // (0) Registro cerrado (F14D): el signup libre ya no existe. Cinturón y
  // tirantes por si queda algún enlace rancio o alguien teclea la URL:
  // /{locale}/signup (o /signup pelado) → /{locale}/signin. La ruta ya está
  // borrada; esto solo evita un 404 y deja claro que se entra por invitación.
  const { searchParams, pathname } = request.nextUrl;
  const signupMatch = pathname.match(/^\/(es|en|va)\/signup(?:\/.*)?$/);
  if (signupMatch || pathname === '/signup' || pathname.startsWith('/signup/')) {
    const locale = signupMatch?.[1] ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/signin`, request.url));
  }

  // (1) Reenrutar artefactos de auth sueltos hacia /auth/callback.
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const hasAuthArtifact = code !== null || (tokenHash !== null && type !== null);
  if (hasAuthArtifact && !pathname.startsWith('/auth/callback')) {
    const callbackUrl = new URL('/auth/callback', request.url);
    if (code) callbackUrl.searchParams.set('code', code);
    if (tokenHash) callbackUrl.searchParams.set('token_hash', tokenHash);
    if (type) callbackUrl.searchParams.set('type', type);
    // Preservamos la ruta original (sin los params de auth) como `next`
    // para que el callback redirija de vuelta tras establecer sesión.
    const cleanedSearch = new URLSearchParams(searchParams);
    cleanedSearch.delete('code');
    cleanedSearch.delete('token_hash');
    cleanedSearch.delete('type');
    const query = cleanedSearch.toString();
    const nextPath = pathname + (query ? `?${query}` : '');
    callbackUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(callbackUrl);
  }

  const response = handleIntl(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Toca getUser para que el cliente refresque el token si toca.
  // Las cookies actualizadas viajan al browser vía `response.cookies.set` arriba.
  // D-4c — el refresh es best-effort: un parpadeo de red no debe expulsar a un
  // usuario con sesión válida (las páginas protegidas revalidan por su cuenta).
  // Capturamos el fallo para no perderlo y DEJAMOS SEGUIR la request.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { feature: 'auth', step: 'middleware_refresh' },
    });
  }

  // ── El candado de la contraseña ───────────────────────────────────────────
  //
  // Una sesión que nace del enlace de recuperación lo dice en su propio token
  // (`amr`), así que esto no consulta ningún estado nuestro: ni cookie, ni tabla.
  // La decisión vive en core, con pruebas (`requiresPasswordChange`); aquí solo
  // se aplica. Y se abre sola: la acción de `/reset-password` vuelve a
  // autenticar al terminar, lo que crea una sesión con `amr` de contraseña.
  //
  // EL TOKEN NO SE VUELVE A VERIFICAR: `getUser()`, justo arriba, ya lo ha hecho
  // contra GoTrue. Aquí solo se leen las reclamaciones del que ya está validado,
  // sin una segunda llamada.
  //
  // LAS RUTAS `/api` NO ENTRAN, Y NO ES UN OLVIDO NI DEUDA: es decisión tomada.
  // Quien tiene el enlace ya tiene acceso a la cuenta, así que el candado no es
  // una barrera de seguridad — es para que la persona acabe con una contraseña
  // nueva, que es lo que pidió. Taparlas añadiría una capa que no protege de
  // nadie y que habría que mantener en cada endpoint nuevo. (De hecho el
  // `matcher` de abajo ya las excluye; esto explica por qué se deja así.)
  const destinoCandado = `/${localeFromPath(pathname, routing.locales, routing.defaultLocale)}/reset-password`;
  // El orden importa poco para la corrección y mucho para el coste: estando
  // encerrado, la pantalla que más se pide es justo el destino, y ahí no hace
  // falta ni mirar el token.
  if (user && pathname !== destinoCandado && (await requiereContrasenaNueva(supabase))) {
    const redirectRes = NextResponse.redirect(new URL(destinoCandado, request.url));
    // Preserva las cookies que Supabase/next-intl hayan escrito sobre `response`.
    for (const c of response.cookies.getAll()) redirectRes.cookies.set(c);
    return redirectRes;
  }

  // F14J-2 — Portada "elige tu club": la RAÍZ pública (misterfc.es → /{locale})
  // SIN sesión muestra la portada de clubes, no el login. Es SOLO la raíz: los
  // deep-links sin sesión siguen yendo a /signin vía el layout autenticado (sin
  // cambios), así el login sigue accesible. Con sesión, la raíz pasa al home de
  // la app como hasta ahora (no entra aquí).
  const localeRoot = pathname.match(/^\/(es|en|va)$/);
  if (localeRoot && !user) {
    const redirectRes = NextResponse.redirect(
      new URL(`/${localeRoot[1]}/clubes`, request.url),
    );
    // Preserva las cookies que Supabase/next-intl hayan escrito sobre `response`.
    for (const c of response.cookies.getAll()) redirectRes.cookies.set(c);
    return redirectRes;
  }

  return response;
}

/**
 * Lee `amr` del token que `getUser()` acaba de validar.
 *
 * `getSession()` lee de la cookie SIN verificar, y por eso no se usa para decidir
 * quién es nadie — para eso está el `getUser()` de arriba. Lo que se saca de aquí
 * es solo el cuerpo del mismo token ya validado, que es donde viaja `amr`;
 * `getUser()` no lo devuelve.
 *
 * El parámetro se tipa por lo ÚNICO que se usa —`getSession`— y no como el cliente
 * entero: así la firma dice sola que esto no consulta la base ni vuelve a GoTrue, y
 * no queda atada a los genéricos de `createServerClient`.
 *
 * Cualquier tropiezo (sin sesión, token ilegible) responde `false`: el candado
 * falla ABIERTO a propósito. Equivocarse cerrando deja a alguien dando vueltas
 * sin salida; equivocarse abriendo solo significa que sigue con su contraseña
 * vieja un rato más, que es exactamente donde estábamos antes de esta pieza.
 */
async function requiereContrasenaNueva(supabase: {
  auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> };
}): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const payload = token.split('.')[1];
    if (!payload) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      amr?: unknown;
    };
    return requiresPasswordChange(claims.amr);
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    // Excluye: rutas API/internas, el callback de auth (route handler propio),
    // y cualquier path con extensión (favicon, assets…).
    '/((?!api|_next|_vercel|monitoring|auth/callback|.*\\..*).*)',
  ],
};
