import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Callback del magic link de Supabase Auth.
 *
 * Diseño cookie-handling:
 *   Construimos primero el `NextResponse.redirect(...)` y le pasamos al cliente
 *   Supabase un adapter que escribe directamente sobre `response.cookies`.
 *   Patrón recomendado por Supabase para Route Handlers + redirect:
 *   https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 *   La alternativa de usar `next/headers.cookies()` + `NextResponse.redirect`
 *   puede en algunos casos no propagar los Set-Cookie headers al response que
 *   construimos manualmente, especialmente con Next 16 + Turbopack. Mejor
 *   atarse al response directamente.
 *
 * Flujo:
 *   - Llega `/auth/callback?code=<otp>&next=<path>` desde Supabase.
 *   - Intercambiamos el code → cookies set en response.
 *   - Redirigimos al `next` (validado como path relativo) o a `/`.
 *   - Si falla → redirect a `/es/signin?error=callback_failed`.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }
  return '/';
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description');
  const next = searchParams.get('next');

  if (errorParam || !code) {
    return NextResponse.redirect(`${origin}/es/signin?error=callback_failed`);
  }

  // Construimos el redirect ANTES de exchangear, para escribir cookies sobre él.
  const response = NextResponse.redirect(`${origin}${safeNextPath(next)}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.redirect(`${origin}/es/signin?error=callback_failed`);
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/es/signin?error=callback_failed`);
  }

  return response;
}
