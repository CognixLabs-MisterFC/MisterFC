'use server';

import { redirect } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { resetPasswordSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ResetPasswordFormState = {
  error?: 'invalid_input' | 'password_too_short' | 'password_mismatch' | 'no_session' | 'generic';
};

/**
 * Server Action: aplica la nueva contraseña.
 *
 * Asume sesión activa (la trajo el enlace del correo). Si no hay sesión devuelve
 * `no_session` — la página enseña que hay que pedir otro enlace.
 *
 * ── POR QUÉ VUELVE A AUTENTICAR AL TERMINAR ────────────────────────────────
 *
 * Para que la sesión deje de ser «de recuperación» y pase a ser una sesión
 * normal. La diferencia está en el JWT, en la reclamación `amr`, y está MEDIDA
 * contra GoTrue de producción (21-09-2026, sonda con cuenta desechable):
 *
 *   entrar con contraseña ....... amr = [{ method: "password" }]
 *   llegar por el enlace ........ amr = [{ method: "otp" }]
 *
 * Y lo que obliga a esta llamada: **`amr` NO cambia al cambiar la contraseña**.
 * Ni en el token que ya se tenía ni en uno refrescado — marca el ORIGEN de la
 * sesión, no si ya se fijó una contraseña. Volver a autenticar crea una sesión
 * nueva cuyo `amr` sí dice `password`.
 *
 * Eso es lo que permite que el candado que viene después (obligar a cambiar la
 * contraseña antes de seguir) sea una función PURA del token: sin cookie que
 * mantener, sin tabla y sin migración. Cambiar la contraseña lo abre por
 * construcción, y no hay dos estados que se puedan desincronizar.
 *
 * NO PASA NADA CON LAS CUENTAS SIN CONFIRMAR, que es lo primero que da miedo
 * aquí: una cuenta con `email_confirmed_at` nulo no puede hacer login (400
 * `email_not_confirmed`), y son justo las que dejó el BUG 4. Medido: el
 * `/verify` del enlace de recuperación **confirma el correo por el camino**, así
 * que para cuando llega esta llamada la cuenta ya puede entrar.
 *
 * SI AUN ASÍ FALLA (un parpadeo de red), la contraseña YA ESTÁ CAMBIADA y no se
 * le dice lo contrario a nadie: se registra y se sigue. Con el candado puesto
 * eso devuelve a esta misma pantalla una vez más, y el segundo intento vuelve a
 * probar — se cura solo. Cerrar la sesión aquí sería más ruidoso y no más
 * seguro.
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

  // A partir de aquí la contraseña YA está cambiada: ningún camino de abajo
  // puede devolver un error, o estaríamos diciendo que no se guardó algo que sí.
  if (user.email) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.password,
    });
    if (signInError) {
      Sentry.captureException(signInError, {
        tags: { feature: 'auth', step: 'reset_password_reauth' },
      });
    }
  }

  redirect(`/${locale}`);
}
