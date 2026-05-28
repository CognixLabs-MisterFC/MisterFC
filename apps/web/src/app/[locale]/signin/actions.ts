'use server';

import { redirect } from 'next/navigation';
import { signinSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type SigninFormState = {
  error?: 'invalid_input' | 'invalid_credentials' | 'email_not_confirmed' | 'generic';
};

/**
 * Server Action del signin.
 *
 * Autentica con email + password contra Supabase Auth. Discrimina:
 *  - `invalid_input`: el form no pasó Zod (email mal formado o password vacío).
 *  - `invalid_credentials`: combinación email/password incorrecta.
 *  - `email_not_confirmed`: el user existe pero no verificó el email aún
 *    (signup pendiente de confirmación).
 *  - `generic`: cualquier otro error de Supabase.
 *
 * En éxito, redirige a `/<locale>`. El home decide a dónde mandarlo según
 * memberships (onboarding, dashboard, etc.).
 */
export async function signInWithPassword(
  locale: string,
  _prev: SigninFormState,
  formData: FormData,
): Promise<SigninFormState> {
  const parsed = signinSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'invalid_input' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Supabase devuelve códigos estables a partir de @supabase/supabase-js 2.x.
    // `error.code` es el contrato preferente; `error.message` es backup.
    const code = 'code' in error ? error.code : undefined;
    if (
      code === 'invalid_credentials' ||
      error.message?.toLowerCase().includes('invalid login credentials')
    ) {
      return { error: 'invalid_credentials' };
    }
    if (
      code === 'email_not_confirmed' ||
      error.message?.toLowerCase().includes('email not confirmed')
    ) {
      return { error: 'email_not_confirmed' };
    }
    return { error: 'generic' };
  }

  redirect(`/${locale}`);
}
