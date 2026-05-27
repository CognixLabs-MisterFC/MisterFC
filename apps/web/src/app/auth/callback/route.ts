import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/**
 * Callback del magic link de Supabase Auth.
 *
 * Supabase redirige a `/auth/callback?code=<otp>` tras hacer click en el link.
 * Aquí intercambiamos el `code` por una sesión (cookies se setean automáticamente
 * vía nuestro CookieAdapter sobre `next/headers.cookies()`).
 *
 * - Si todo OK → redirect a `/` (next-intl decidirá el locale; home decidirá
 *   si pasa a onboarding o muestra dashboard).
 * - Si falla → redirect a `/es/signin?error=callback_failed`. Hardcodeamos `es`
 *   porque no sabemos el locale preferido del user (aún no hay sesión).
 *
 * Esta ruta está fuera de `[locale]` a propósito: la URL es la que se configura
 * en Supabase Dashboard y no debe llevar prefijo de idioma.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description');

  if (errorParam || !code) {
    return NextResponse.redirect(`${origin}/es/signin?error=callback_failed`);
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/es/signin?error=callback_failed`);
  }

  // Home decide adónde llevar al user en función de sus memberships.
  return NextResponse.redirect(`${origin}/`);
}
