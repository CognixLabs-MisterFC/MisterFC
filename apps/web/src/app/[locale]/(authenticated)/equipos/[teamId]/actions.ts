'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  sendStaffInvitationSchema,
  type TeamStaffRole,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// Invitar staff a un equipo (F2.6)
// ─────────────────────────────────────────────────────────────────────────────

export type InviteStaffState = {
  error?:
    | 'email_invalid'
    | 'email_too_long'
    | 'team_staff_role_invalid'
    | 'forbidden'
    | 'principal_exists'
    | 'generic';
  ok?: { email: string };
};

const STAFF_ROLE_TO_MEMBERSHIP_ROLE: Record<TeamStaffRole, string> = {
  entrenador_principal: 'entrenador_principal',
  entrenador_ayudante: 'entrenador_ayudante',
  preparador_fisico: 'entrenador_ayudante',
  delegado: 'entrenador_ayudante',
};

export async function inviteStaffToTeam(
  locale: string,
  teamId: string,
  _prev: InviteStaffState,
  formData: FormData
): Promise<InviteStaffState> {
  const parsed = sendStaffInvitationSchema.safeParse({
    email: formData.get('email'),
    team_staff_role: formData.get('team_staff_role'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (
      code === 'email_invalid' ||
      code === 'email_too_long' ||
      code === 'team_staff_role_invalid'
    ) {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // Cargar club del team (RLS rechaza si el user no pertenece).
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return { error: 'forbidden' };
  const clubId = (team.categories as unknown as { club_id: string }).club_id;

  const membershipRole =
    STAFF_ROLE_TO_MEMBERSHIP_ROLE[parsed.data.team_staff_role];

  // Verificación principal único: si ya hay principal activo en el team,
  // rechazar antes de gastar email.
  if (parsed.data.team_staff_role === 'entrenador_principal') {
    const { data: existing } = await supabase
      .from('team_staff')
      .select('id')
      .eq('team_id', teamId)
      .eq('staff_role', 'entrenador_principal')
      .is('left_at', null)
      .maybeSingle();
    if (existing) {
      return { error: 'principal_exists' };
    }
  }

  const { data: invite, error: insErr } = await supabase
    .from('invitations')
    .insert({
      email: parsed.data.email,
      role: membershipRole,
      club_id: clubId,
      team_id: teamId,
      team_staff_role: parsed.data.team_staff_role,
      created_by: user.id,
    })
    .select('id, token')
    .single();

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr, {
      tags: { feature: 'invitations', step: 'insert_staff' },
      extra: {
        team_id: teamId,
        team_staff_role: parsed.data.team_staff_role,
      },
    });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'generic' };

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const next = `/${locale}/invite/${invite.token}`;
  const redirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(next)}`;

  const admin = createSupabaseAdminClient();
  try {
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      }
    );

    if (invErr) {
      const msg = invErr.message?.toLowerCase() ?? '';
      const alreadyExists =
        ('code' in invErr && invErr.code === 'email_exists') ||
        msg.includes('already been registered') ||
        msg.includes('already exists');

      if (alreadyExists) {
        const { error: resetErr } =
          await supabase.auth.resetPasswordForEmail(parsed.data.email, {
            redirectTo,
          });
        if (resetErr) {
          Sentry.captureException(resetErr, {
            tags: { feature: 'invitations', step: 'reset_fallback_staff' },
            extra: { invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        Sentry.captureException(invErr, {
          tags: { feature: 'invitations', step: 'inviteUserByEmail_staff' },
          extra: { invitation_id: invite.id },
        });
        return { error: 'generic' };
      }
    }
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'inviteUserByEmail_staff_thrown' },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}`, 'page');
  return { ok: { email: parsed.data.email } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quitar staff del equipo (cierra left_at = today)
// ─────────────────────────────────────────────────────────────────────────────

export type RemoveStaffResult =
  | { success: true }
  | { success: false; error: 'forbidden' | 'generic' };

export async function removeTeamStaff(
  teamId: string,
  teamStaffId: string
): Promise<RemoveStaffResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('team_staff')
    .update({ left_at: today })
    .eq('id', teamStaffId)
    .is('left_at', null);

  if (error) {
    if (error.code === '42501') return { success: false, error: 'forbidden' };
    return { success: false, error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}`, 'page');
  return { success: true };
}
