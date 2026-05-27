'use server';

import { redirect } from 'next/navigation';
import { resetPasswordSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ResetPasswordFormState = {
  error?: 'invalid_input' | 'password_too_short' | 'password_mismatch' | 'no_session' | 'generic';
};

/**
 * Server Action: aplica la nueva contraseña.
 *
 * Asume sesión activa (la trajo el callback tras click en email de reset).
 * Si no hay sesión, devuelve `no_session` — la page deber mostrar al user
 * que vuelva a pedir un reset.
 *
 * Tras éxito redirige a `/<locale>` (home decide).
 */
export async function resetPassword(
  locale: string,
  _prev: ResetPasswordFormState,
  formData: FormData,
): Promise<ResetPasswordFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.message === 'password_too_short') {
      return { error: 'password_too_short' };
    }
    if (issue?.message === 'password_mismatch') {
      return { error: 'password_mismatch' };
    }
    return { error: 'invalid_input' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'no_session' };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: 'generic' };
  }

  redirect(`/${locale}`);
}
