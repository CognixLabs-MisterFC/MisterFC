'use server';

import { redirect } from 'next/navigation';
import {
  acceptInvitationWithProfileSchema,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type AcceptInvitationState = {
  error?:
    | 'not_found'
    | 'expired'
    | 'already_accepted'
    | 'wrong_email'
    | 'invalid_input'
    | 'full_name_too_short'
    | 'full_name_too_long'
    | 'date_of_birth_invalid'
    | 'password_too_short'
    | 'password_mismatch'
    | 'no_session'
    | 'generic';
};

/**
 * Verifica la invitación y devuelve datos seguros para el caller. Centraliza
 * los chequeos de existencia / expiración / propietario para que las dos
 * server actions (con y sin password) compartan el mismo gate.
 */
async function loadAndAssertInvitation(token: string): Promise<
  | {
      ok: true;
      invitation: {
        id: string;
        club_id: string;
        role: string;
        email: string;
        player_id: string | null;
        player_relation: string | null;
      };
    }
  | { ok: false; error: NonNullable<AcceptInvitationState['error']> }
> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'no_session' };
  }

  const { data: inv, error } = await supabase
    .from('invitations')
    .select(
      'id, email, club_id, role, expires_at, accepted_at, player_id, player_relation'
    )
    .eq('token', token)
    .maybeSingle();

  if (error) return { ok: false, error: 'generic' };
  if (!inv) return { ok: false, error: 'not_found' };
  if (inv.accepted_at) return { ok: false, error: 'already_accepted' };
  if (new Date(inv.expires_at) < new Date()) return { ok: false, error: 'expired' };
  if (
    !user.email ||
    user.email.trim().toLowerCase() !== inv.email.trim().toLowerCase()
  ) {
    return { ok: false, error: 'wrong_email' };
  }

  return {
    ok: true,
    invitation: {
      id: inv.id,
      club_id: inv.club_id,
      role: inv.role,
      email: inv.email,
      player_id: inv.player_id,
      player_relation: inv.player_relation,
    },
  };
}

/**
 * Inserta membership + (si aplica) vínculo player_accounts + marca invitación
 * como aceptada. Asume que `loadAndAssertInvitation` ha validado todo antes.
 */
async function attachToClub(
  invitation: {
    id: string;
    club_id: string;
    role: string;
    player_id: string | null;
    player_relation: string | null;
  },
  profileId: string
): Promise<AcceptInvitationState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error: mErr } = await supabase.from('memberships').insert({
    profile_id: profileId,
    club_id: invitation.club_id,
    role: invitation.role,
  });

  if (mErr) {
    // 23505 = unique violation: membership ya existía. No es un error fatal;
    // seguimos para no dejar la invitación colgada en estado pendiente.
    if (mErr.code !== '23505') {
      return { error: 'generic' };
    }
  }

  // Si la invitación llevaba vinculación a jugador (tutor familiar), insertar
  // player_accounts. Solo aplicable cuando role=jugador + player_id presente
  // (el CHECK estructural de la migración F2.4 garantiza el resto).
  if (
    invitation.role === 'jugador' &&
    invitation.player_id &&
    invitation.player_relation
  ) {
    const { error: paErr } = await supabase.from('player_accounts').insert({
      player_id: invitation.player_id,
      profile_id: profileId,
      relation: invitation.player_relation as 'parent' | 'guardian',
    });
    // 23505 = vínculo ya existía (caso poco probable: misma pareja
    // player+profile re-invitada). No abortamos.
    if (paErr && paErr.code !== '23505') {
      return { error: 'generic' };
    }
  }

  await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  return {};
}

/**
 * Flujo "invitee ya tiene password" (p.ej. pertenece a otro club).
 *
 * No pide nada al user, solo confirma con un click. Crea membership y marca
 * invitación como aceptada. No toca el perfil (el invitee ya lo rellenó cuando
 * se registró la primera vez).
 */
export async function acceptInvitation(
  locale: string,
  token: string
): Promise<AcceptInvitationState> {
  const gate = await loadAndAssertInvitation(token);
  if (!gate.ok) {
    if (gate.error === 'no_session') {
      redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
    }
    return { error: gate.error };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
  }

  const result = await attachToClub(gate.invitation, user.id);
  if (result.error) return result;

  redirect(`/${locale}`);
}

/**
 * Flujo "invitee viene del email de Supabase Invite — set password + perfil".
 *
 * El user llegó con sesión temporal (la creó el callback al canjear el OTP).
 * Le pedimos full_name, date_of_birth (opcional), password + confirm.
 *
 * Acciones:
 *  1. updateUser({ password, data: { full_name, date_of_birth, locale } }) —
 *     fija password y propaga datos a raw_user_meta_data.
 *  2. UPDATE profiles SET full_name, date_of_birth, locale WHERE id = auth.uid()
 *     — el trigger `handle_new_user` ya creó la fila pero solo con los datos
 *     pasados en `inviteUserByEmail` (que NO incluyen full_name). Hacemos UPDATE
 *     explícito para que el perfil quede coherente con lo que el invitee acaba
 *     de introducir.
 *  3. INSERT en memberships + UPDATE invitations.accepted_at.
 */
export async function acceptInvitationWithProfile(
  locale: string,
  token: string,
  _prev: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  const parsed = acceptInvitationWithProfileSchema.safeParse({
    full_name: formData.get('full_name'),
    date_of_birth: formData.get('date_of_birth'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.message === 'full_name_too_short') return { error: 'full_name_too_short' };
    if (issue?.message === 'full_name_too_long') return { error: 'full_name_too_long' };
    if (issue?.message === 'date_of_birth_invalid') return { error: 'date_of_birth_invalid' };
    if (issue?.message === 'password_too_short') return { error: 'password_too_short' };
    if (issue?.message === 'password_mismatch') return { error: 'password_mismatch' };
    return { error: 'invalid_input' };
  }

  const gate = await loadAndAssertInvitation(token);
  if (!gate.ok) {
    if (gate.error === 'no_session') {
      redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
    }
    return { error: gate.error };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
  }

  // Paso 1: password + metadata en auth.users (transporte de datos para clientes
  // que lean raw_user_meta_data en el futuro).
  const { error: updErr } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: {
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
      locale,
    },
  });
  if (updErr) {
    return { error: 'generic' };
  }

  // Paso 2: UPDATE profiles. El trigger handle_new_user creó la fila vacía
  // (sin full_name), así que rellenamos aquí lo que el invitee introdujo.
  // La policy de profiles permite al propio user actualizar su fila.
  const { error: profErr } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
      locale,
    })
    .eq('id', user.id);
  if (profErr) {
    return { error: 'generic' };
  }

  // Paso 3: membership + accept.
  const result = await attachToClub(gate.invitation, user.id);
  if (result.error) return result;

  redirect(`/${locale}`);
}
