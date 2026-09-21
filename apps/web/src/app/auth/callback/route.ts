import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import * as Sentry from '@sentry/nextjs';
import { planAuthCallback, localeFromPath } from '@misterfc/core';
import { routing } from '@/i18n/routing';

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
 * Qué hacer con lo que llega lo decide `planAuthCallback` (core, con tests):
 *   - `code` (PKCE, lo más común desde Supabase Auth v2) → canjear.
 *   - `token_hash` + `type` (OTP) → verificar.
 *   - NADA en la query pero sí un `next` → DEJAR PASAR. BUG-4: los flujos
 *     implícitos devuelven la sesión en el FRAGMENTO (`#access_token=…`), que un
 *     Route Handler no puede ver. Antes esto se daba por enlace roto y se iba a
 *     signin tirando el destino; el navegador arrastraba el fragmento hasta allí,
 *     `AuthHashHandler` lo canjeaba y el usuario entraba en la app sin que nadie
 *     le pidiera la contraseña nueva. Ahora seguimos al destino y el fragmento
 *     se canja donde toca.
 *   - Ni artefactos ni destino, o error explícito → signin.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  /**
   * A dónde mandar a alguien si esto sale mal, Y EN QUÉ IDIOMA. Esta ruta vive fuera
   * del segmento `[locale]`, así que el idioma no llega por parámetro: se lee del
   * destino al que la persona iba. Antes estaba escrito a mano como `/es/signin`, y
   * el aviso de «no hemos podido completar el acceso» habría sido inalcanzable en
   * valenciano y en inglés.
   */
  const locale = localeFromPath(
    searchParams.get('next'),
    routing.locales,
    routing.defaultLocale,
  );
  const signinConError = `${origin}/${locale}/signin?error=callback_failed`;

  const plan = planAuthCallback({
    code: searchParams.get('code'),
    tokenHash: searchParams.get('token_hash'),
    type: searchParams.get('type'),
    error: searchParams.get('error') ?? searchParams.get('error_description'),
    next: searchParams.get('next'),
  });

  if (plan.kind === 'fail') {
    // D-4c — este redirect descarta el motivo real. No hay objeto Error
    // (Supabase pasa el fallo como query param, o simplemente no llegan
    // artefactos), así que reportamos el contexto con captureMessage.
    Sentry.captureMessage('auth callback: bad params', {
      level: 'warning',
      tags: { feature: 'auth', step: 'callback_bad_params', reason: plan.reason },
      extra: {
        reason: plan.reason,
        error_param: searchParams.get('error') ?? searchParams.get('error_description'),
        has_token_hash: searchParams.get('token_hash') !== null,
        type_param: searchParams.get('type'),
      },
    });
    return NextResponse.redirect(signinConError);
  }

  // Construimos el redirect ANTES de exchangear, para escribir cookies sobre él.
  const response = NextResponse.redirect(`${origin}${plan.destination}`);

  // Flujo implícito: no hay nada que canjear aquí, la sesión viaja en el
  // fragmento y la recoge el cliente en el destino.
  if (plan.kind === 'passthrough') return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.redirect(signinConError);
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

  if (plan.kind === 'exchange_code') {
    const { error } = await supabase.auth.exchangeCodeForSession(plan.code);
    if (error) {
      // D-4c — capturamos el error real antes de tirarlo; el usuario sigue
      // viendo el mismo callback_failed genérico.
      Sentry.captureException(error, {
        tags: { feature: 'auth', step: 'callback_exchange' },
      });
      return NextResponse.redirect(signinConError);
    }
  } else {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: plan.tokenHash,
      type: plan.otpType,
    });
    if (error) {
      // D-4c — capturamos el error real antes de tirarlo.
      Sentry.captureException(error, {
        tags: { feature: 'auth', step: 'callback_verify' },
      });
      return NextResponse.redirect(signinConError);
    }
  }

  return response;
}
