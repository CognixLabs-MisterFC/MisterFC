import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
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
 * No hace redirects de auth aquí (más allá del callback); cada página decide
 * qué hacer en función de `getCurrentUser()`. Eso evita doble lógica de
 * protección.
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
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Excluye: rutas API/internas, el callback de auth (route handler propio),
    // y cualquier path con extensión (favicon, assets…).
    '/((?!api|_next|_vercel|monitoring|auth/callback|.*\\..*).*)',
  ],
};
