'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type AcceptInvitationState = {
  error?: 'not_found' | 'expired' | 'already_accepted' | 'wrong_email' | 'generic';
};

/**
 * Server Action: acepta una invitación.
 *
 * Reglas de seguridad:
 *  - Debe existir invitación con ese token.
 *  - No expirada.
 *  - No aceptada antes.
 *  - El email del user actual debe coincidir con el email de la invitación
 *    (case-insensitive). Sin este check, cualquiera que tenga el token podría
 *    unirse al club aunque la invitación no fuera para él.
 *
 * Acción:
 *  - INSERT en memberships (profile_id=user.id, club_id, role).
 *  - El trigger ensure_assistant_capabilities (1.4) siembra capabilities si
 *    el rol es entrenador_ayudante.
 *  - UPDATE invitations SET accepted_at = now().
 */
export async function acceptInvitation(
  locale: string,
  token: string
): Promise<AcceptInvitationState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  const { data: inv, error: invErr } = await supabase
    .from('invitations')
    .select('id, email, club_id, role, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle();
  if (invErr) {
    return { error: 'generic' };
  }
  if (!inv) {
    return { error: 'not_found' };
  }
  if (inv.accepted_at) {
    return { error: 'already_accepted' };
  }
  if (new Date(inv.expires_at) < new Date()) {
    return { error: 'expired' };
  }
  if (
    !user.email ||
    user.email.trim().toLowerCase() !== inv.email.trim().toLowerCase()
  ) {
    return { error: 'wrong_email' };
  }

  const { error: mErr } = await supabase.from('memberships').insert({
    profile_id: user.id,
    club_id: inv.club_id,
    role: inv.role,
  });
  if (mErr) {
    // Si ya existe el membership (unique violation 23505), seguimos al accepted_at
    // para no dejar la invitación colgada.
    if (mErr.code !== '23505') {
      return { error: 'generic' };
    }
  }

  await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id);

  redirect(`/${locale}`);
}
