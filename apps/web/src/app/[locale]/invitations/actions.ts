'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  sendInvitationSchema,
  createSupabaseServerClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type SendInvitationFormState = {
  error?: 'invalid_input' | 'forbidden' | 'no_club' | 'generic';
  ok?: { email: string };
};

const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'coordinador'];

/**
 * Server Action: crea una invitación y dispara el magic link.
 *
 * Reglas:
 *  - El user actual debe tener role admin_club o coordinador en el club activo.
 *  - En Fase 1 asumimos que el user solo administra **un** club (el primero
 *    de sus memberships). En Fase 2, cuando exista UI multi-club, esto se
 *    pasará explícito por param.
 *  - El magic link redirige tras autenticación a /[locale]/invite/{token}.
 */
export async function sendInvitation(
  locale: string,
  _prev: SendInvitationFormState,
  formData: FormData
): Promise<SendInvitationFormState> {
  const teamIdRaw = formData.get('team_id');
  const parsed = sendInvitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    team_id: teamIdRaw && String(teamIdRaw).length > 0 ? teamIdRaw : null,
  });
  if (!parsed.success) {
    return { error: 'invalid_input' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  const { data: memberships, error: mErr } = await supabase
    .from('memberships')
    .select('id, club_id, role')
    .eq('profile_id', user.id);
  if (mErr || !memberships || memberships.length === 0) {
    return { error: 'no_club' };
  }

  const authorized = memberships.find((m) =>
    ROLES_ALLOWED_TO_INVITE.includes(m.role as Role)
  );
  if (!authorized) {
    return { error: 'forbidden' };
  }

  const { data: invite, error: insErr } = await supabase
    .from('invitations')
    .insert({
      email: parsed.data.email,
      role: parsed.data.role,
      club_id: authorized.club_id,
      team_id: parsed.data.team_id ?? null,
      created_by: user.id,
    })
    .select('token')
    .single();
  if (insErr || !invite) {
    return { error: 'generic' };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const next = `/${locale}/invite/${invite.token}`;
  const emailRedirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(
    next
  )}`;

  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
    },
  });
  if (otpErr) {
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/invitations`);
  return { ok: { email: parsed.data.email } };
}
