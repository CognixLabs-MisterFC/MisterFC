'use server';

import { redirect } from 'next/navigation';
import {
  signinSchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { setActiveClub } from '@/components/shell/actions';

/**
 * Estado del login-por-club. UN ÚNICO error `invalid` para los TRES casos
 * (email mal / password mal / no pertenece al club). Requisito de seguridad de
 * Jose: nunca revelar cuál falló, para no filtrar que un email existe en otro
 * club. El texto lo pinta el form desde i18n `clubLogin.error`.
 */
export type ClubLoginState = {
  error?: 'invalid';
};

/**
 * Server Action del login por club (misterfc.es/{slug}, F14J-3b).
 *
 * Flujo:
 *   1. signInWithPassword(email, password).
 *   2. Credenciales mal (o input mal formado) → error genérico único.
 *   3. OK → ¿es MIEMBRO del club de este slug? (membership real; el acceso
 *      sintético de superadmin no cuenta: el login por /{slug} es para socios).
 *        - Miembro → setActiveClub(clubId) fija ESE club (revalida membership y
 *          escribe la cookie active_club_id) → entra a /{locale} con ese club
 *          activo, sin caer en clubs[0].
 *        - NO miembro → signOut (no dejarlo logueado sin club válido) + el mismo
 *          error genérico → se queda en /{slug}.
 */
export async function loginToClub(
  locale: string,
  clubId: string,
  _prev: ClubLoginState,
  formData: FormData,
): Promise<ClubLoginState> {
  const parsed = signinSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    // Input mal formado también cae en el error único (no revelamos nada).
    return { error: 'invalid' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: 'invalid' };
  }

  // Autenticó OK → comprobamos membership en el club del slug. Reusa el mismo
  // adapter, así que ve la sesión recién escrita por signInWithPassword.
  const clubs = await getCurrentUserClubs(adapter);
  const isMember = clubs.some((c) => c.club.id === clubId);

  if (!isMember) {
    await supabase.auth.signOut();
    return { error: 'invalid' };
  }

  // Miembro → ese club como activo (setActiveClub revalida membership) y a la app.
  await setActiveClub(clubId);
  redirect(`/${locale}`);
}
