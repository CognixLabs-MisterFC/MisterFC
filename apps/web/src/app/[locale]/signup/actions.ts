'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signupSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type SignupFormState = {
  error?:
    | 'invalid_input'
    | 'full_name_too_short'
    | 'full_name_too_long'
    | 'password_too_short'
    | 'password_mismatch'
    | 'user_already_exists'
    | 'generic';
};

/**
 * Server Action de signup público.
 *
 * Crea cuenta con email + password + datos mínimos de perfil (full_name + locale).
 * El `locale` se hereda de la URL activa (el param `locale` de la ruta).
 *
 * `data: { full_name, locale }` se propaga a `auth.users.raw_user_meta_data`,
 * y el trigger `handle_new_user` los lee al crear la fila en `public.profiles`.
 *
 * Si Supabase Auth tiene "Confirm email" activado (debe estarlo en producción),
 * el user queda pendiente de verificación y recibe un email con el link de
 * confirmación. Tras éxito redirige a /<locale>/check-email?context=signup.
 */
export async function signUp(
  locale: string,
  _prev: SignupFormState,
  formData: FormData
): Promise<SignupFormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.message === 'full_name_too_short') return { error: 'full_name_too_short' };
    if (issue?.message === 'full_name_too_long') return { error: 'full_name_too_long' };
    if (issue?.message === 'password_too_short') return { error: 'password_too_short' };
    if (issue?.message === 'password_mismatch') return { error: 'password_mismatch' };
    return { error: 'invalid_input' };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const emailRedirectTo = `${proto}://${host}/auth/callback`;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
      data: {
        full_name: parsed.data.full_name,
        locale,
      },
    },
  });

  if (error) {
    const code = 'code' in error ? error.code : undefined;
    if (
      code === 'user_already_exists' ||
      error.message?.toLowerCase().includes('already registered') ||
      error.message?.toLowerCase().includes('already exists')
    ) {
      return { error: 'user_already_exists' };
    }
    return { error: 'generic' };
  }

  redirect(
    `/${locale}/check-email?context=signup&email=${encodeURIComponent(parsed.data.email)}`
  );
}
