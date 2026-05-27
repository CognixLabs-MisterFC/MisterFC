import { type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import { routing } from './i18n/routing';

const handleIntl = createIntlMiddleware(routing);

/**
 * Middleware combinado:
 *
 *   1. Refresca la sesión Supabase leyendo/escribiendo cookies sobre el
 *      response. Sin esto, los tokens caducan en el browser pero no se
 *      refrescan en server-side y los Server Components ven al user como
 *      desconectado.
 *
 *   2. Aplica el routing i18n de next-intl (prefijo de locale).
 *
 * No hace redirects de auth aquí; cada página decide qué hacer en función
 * de `getCurrentUser()`. Eso evita doble lógica de protección.
 */
export default async function middleware(request: NextRequest) {
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
