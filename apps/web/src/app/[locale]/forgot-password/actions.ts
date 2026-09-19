'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  forgotPasswordSchema,
  createSupabaseServerClient,
  recoveryRedirectTo,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ForgotPasswordFormState = {
  error?: 'invalid_email' | 'generic';
};

/**
 * Server Action: pide reset de contraseña.
 *
 * Llama a `supabase.auth.resetPasswordForEmail`. Por diseño, Supabase NO
 * revela si el email existe o no — devuelve éxito en ambos casos. Por eso
 * redirigimos siempre a /check-email con context=reset.
 *
 * `redirectTo` apunta DIRECTO a /{locale}/reset-password (BUG-4). El rodeo por
 * /auth/callback perdía la pantalla cuando el flujo era implícito; ver
 * `recoveryRedirectTo` en core. Con PKCE —que es lo que usa esta Server Action,
 * vía @supabase/ssr— llega `?code=` y el middleware lo reencamina al callback.
 */
export async function requestPasswordReset(
  locale: string,
  _prev: ForgotPasswordFormState,
  formData: FormData,
): Promise<ForgotPasswordFormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return { error: 'invalid_email' };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const redirectTo = recoveryRedirectTo(`${proto}://${host}`, locale);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });

  if (error) {
    return { error: 'generic' };
  }

  redirect(`/${locale}/check-email?context=reset&email=${encodeURIComponent(parsed.data.email)}`);
}
