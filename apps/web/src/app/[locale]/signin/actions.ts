'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signinSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type SigninFormState = {
  error?: 'invalid_email' | 'generic';
};

/**
 * Server Action del formulario de signin.
 *
 * Envía un magic link a `email`. Si el email es inválido devuelve estado de
 * error (se renderiza en el form). Si Supabase falla, devuelve `generic`.
 * En caso de éxito redirige a `/<locale>/check-email?email=<email>`.
 *
 * `shouldCreateUser=true` permite que un email nuevo cree cuenta automáticamente.
 * En Fase 1 esto es lo deseable; en fases posteriores con invitaciones se
 * cerrará el embudo a sólo emails invitados.
 */
export async function requestMagicLink(
  locale: string,
  _prev: SigninFormState,
  formData: FormData
): Promise<SigninFormState> {
  const email = String(formData.get('email') ?? '').trim();

  const parsed = signinSchema.safeParse({ email });
  if (!parsed.success) {
    return { error: 'invalid_email' };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const emailRedirectTo = `${proto}://${host}/auth/callback`;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { error: 'generic' };
  }

  redirect(`/${locale}/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}
