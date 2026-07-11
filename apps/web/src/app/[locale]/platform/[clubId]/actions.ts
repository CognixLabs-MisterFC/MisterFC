'use server';

import {
  inviteClubAdmin,
  type InviteClubAdminError,
} from '@/lib/platform/invite-club-admin';

/**
 * F14B-7 — Wrapper con forma de FormState sobre `inviteClubAdmin` (F14B-5b) para
 * usarlo con useActionState desde el form de la pantalla de detalle. La lógica
 * (gate is_superadmin, RPC, inviteUserByEmail) vive en inviteClubAdmin.
 */
export type InviteAdminFormState = {
  ok?: { email: string };
  error?: InviteClubAdminError;
};

export async function inviteAdminAction(
  clubId: string,
  locale: string,
  _prev: InviteAdminFormState,
  formData: FormData,
): Promise<InviteAdminFormState> {
  const email = String(formData.get('email') ?? '').trim();
  if (email.length === 0) return { error: 'invalid_email' };

  const res = await inviteClubAdmin({ clubId, email, locale });
  return 'ok' in res ? { ok: res.ok } : { error: res.error };
}
