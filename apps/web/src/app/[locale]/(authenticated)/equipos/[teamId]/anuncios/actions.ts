'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  announcementInputSchema,
  announcementUpdateSchema,
  updateAnnouncementFromClient,
  deleteAnnouncementFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { userCanPublishAnnouncementsToTeam } from '@/lib/messaging-permissions';
import { publishAnnouncementWeb } from '@/lib/publish-announcement';

/** Sumidero de errores → Sentry, inyectado en los orquestadores de core. */
const sentryLog = (error: unknown, step: string, extra: Record<string, unknown>) =>
  Sentry.captureException(error, { tags: { feature: 'announcements', step }, extra });

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

  // O2-10b-1b — publicar (insert como el usuario + fan-out service-role DESPUÉS) se
  // extrajo a `publishAnnouncementWeb` (core + inyección de notify/Sentry), compartido
  // con el route handler nativo. El gate UX (userCanPublishAnnouncementsToTeam) y el
  // revalidate siguen aquí; comportamiento web idéntico.
  const res = await publishAnnouncementWeb(supabase, {
    clubId,
    authorProfileId: ctx.user.id,
    teamId: parsed.data.team_id,
    title: parsed.data.title,
    body: parsed.data.body,
    pinned: parsed.data.pinned,
    expiresAt: parsed.data.expires_at,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/equipos/${parsed.data.team_id}/anuncios`);
  return { ok: { announcement_id: res.ok.announcementId } };
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

  // O2-10b-1b — editar es RLS directa (sin fan-out: editar NO re-notifica, solo la
  // publicación inicial). Extraído a core (`updateAnnouncementFromClient`).
  const res = await updateAnnouncementFromClient(
    supabase,
    parsed.data.announcement_id,
    {
      title: parsed.data.title,
      body: parsed.data.body,
      pinned: parsed.data.pinned,
      expiresAt: parsed.data.expires_at,
    },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/equipos/${res.ok.teamId}/anuncios`);
  return { ok: { announcement_id: res.ok.announcementId } };
}

export async function deleteAnnouncement(
  locale: string,
  announcementId: string,
): Promise<{ ok?: true; error?: 'forbidden' | 'not_found' | 'generic' }> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // O2-10b-1b — borrar es RLS directa (sin fan-out). Extraído a core
  // (`deleteAnnouncementFromClient`).
  const res = await deleteAnnouncementFromClient(supabase, announcementId, sentryLog);
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/equipos/${res.ok.teamId}/anuncios`);
  return { ok: true };
}
