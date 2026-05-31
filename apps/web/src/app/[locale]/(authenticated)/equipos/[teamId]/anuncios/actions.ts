'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  announcementInputSchema,
  announcementUpdateSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { userCanPublishAnnouncementsToTeam } from '@/lib/messaging-permissions';

export type AnnouncementResult = {
  ok?: { announcement_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'team_not_in_club'
    | 'not_found'
    | 'generic';
};

/**
 * Crea un anuncio en un team del club activo. Permisos: admin/coord/principal
 * por rol; ayudante con cap on, O ayudante con team_staff.staff_role =
 * 'entrenador_principal' DE ESTE team específico. RLS es la autoridad final.
 */
export async function createAnnouncement(
  locale: string,
  input: {
    team_id: string;
    title: string;
    body: string;
    pinned?: boolean | string;
    expires_at?: string | null;
  },
): Promise<AnnouncementResult> {
  const parsed = announcementInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canPublish = await userCanPublishAnnouncementsToTeam(
    supabase,
    ctx,
    parsed.data.team_id,
  );
  if (!canPublish) return { error: 'forbidden' };

  // Verificar que el team pertenece al club activo.
  const { data: teamRow } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', parsed.data.team_id)
    .maybeSingle();
  const teamClubId = (teamRow?.categories as unknown as { club_id: string } | null)?.club_id;
  if (!teamRow || teamClubId !== clubId) return { error: 'team_not_in_club' };

  const { data: created, error: insErr } = await supabase
    .from('announcements')
    .insert({
      team_id: parsed.data.team_id,
      club_id: clubId,
      author_profile_id: ctx.user.id,
      title: parsed.data.title,
      body: parsed.data.body,
      pinned: parsed.data.pinned,
      expires_at: parsed.data.expires_at,
    })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr ?? new Error('insert returned null'), {
      tags: { feature: 'announcements', step: 'create' },
      extra: { team_id: parsed.data.team_id },
    });
    return { error: 'generic' };
  }

  // F5.7 — Notificación a los miembros del team (jugadores + familia).
  try {
    await notifyTeamAnnouncement(
      supabase,
      created.id,
      parsed.data.team_id,
      parsed.data.title,
      parsed.data.body,
      locale,
    );
  } catch (notifyErr) {
    Sentry.captureException(notifyErr, {
      tags: { feature: 'announcements', step: 'notify' },
      extra: { announcement_id: created.id },
    });
  }

  revalidatePath(`/${locale}/equipos/${parsed.data.team_id}/anuncios`);
  return { ok: { announcement_id: created.id } };
}

async function notifyTeamAnnouncement(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  announcementId: string,
  teamId: string,
  title: string,
  body: string,
  locale: string,
): Promise<void> {
  const { data: tms } = await supabase
    .from('team_members')
    .select('player_id')
    .eq('team_id', teamId)
    .is('left_at', null);
  const playerIds = (tms ?? []).map((r) => r.player_id);
  if (playerIds.length === 0) return;

  const { data: pas } = await supabase
    .from('player_accounts')
    .select('profile_id')
    .in('player_id', playerIds);
  const recipientUserIds = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (recipientUserIds.length === 0) return;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipientUserIds.map((u) => ({ user_id: u })),
    {
      type: 'new_announcement',
      in_app_payload: {
        announcement_id: announcementId,
        team_id: teamId,
        deep_link: `/${locale}/anuncios/${announcementId}`,
      },
      push_payload: {
        title,
        body: body.slice(0, 200),
        deep_link: `/${locale}/anuncios/${announcementId}`,
        tag: `announcement:${announcementId}`,
      },
      dedupe_base_prefix: `new_announcement:${announcementId}`,
    },
  );
}

export async function updateAnnouncement(
  locale: string,
  input: {
    announcement_id: string;
    title?: string;
    body?: string;
    pinned?: boolean | string;
    expires_at?: string | null;
  },
): Promise<AnnouncementResult> {
  const parsed = announcementUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Construir patch sólo con campos presentes. Tipo estricto para que el
  // Supabase generated types lo acepte sin caster a Record<string, unknown>.
  const patch: {
    title?: string;
    body?: string;
    pinned?: boolean;
    expires_at?: string | null;
  } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.body !== undefined) patch.body = parsed.data.body;
  if (parsed.data.pinned !== undefined) patch.pinned = parsed.data.pinned;
  if (parsed.data.expires_at !== undefined) patch.expires_at = parsed.data.expires_at;
  if (Object.keys(patch).length === 0) {
    return { ok: { announcement_id: parsed.data.announcement_id } };
  }

  const { data: existing } = await supabase
    .from('announcements')
    .select('id, team_id')
    .eq('id', parsed.data.announcement_id)
    .maybeSingle();
  if (!existing) return { error: 'not_found' };

  const { error: updErr } = await supabase
    .from('announcements')
    .update(patch)
    .eq('id', parsed.data.announcement_id);

  if (updErr) {
    if (updErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(updErr, {
      tags: { feature: 'announcements', step: 'update' },
      extra: { announcement_id: parsed.data.announcement_id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/equipos/${existing.team_id}/anuncios`);
  return { ok: { announcement_id: parsed.data.announcement_id } };
}

export async function deleteAnnouncement(
  locale: string,
  announcementId: string,
): Promise<{ ok?: true; error?: 'forbidden' | 'not_found' | 'generic' }> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: existing } = await supabase
    .from('announcements')
    .select('id, team_id')
    .eq('id', announcementId)
    .maybeSingle();
  if (!existing) return { error: 'not_found' };

  const { error: delErr, count } = await supabase
    .from('announcements')
    .delete({ count: 'exact' })
    .eq('id', announcementId);

  if (delErr) {
    if (delErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(delErr, {
      tags: { feature: 'announcements', step: 'delete' },
      extra: { announcement_id: announcementId },
    });
    return { error: 'generic' };
  }
  if (count === 0) return { error: 'forbidden' };

  revalidatePath(`/${locale}/equipos/${existing.team_id}/anuncios`);
  return { ok: true };
}
