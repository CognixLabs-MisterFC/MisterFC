'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

/**
 * Feature D — anuncios globales del club (admin/coord).
 *
 * Audience options:
 *   - club_wide=true: 1 fila con team_id=NULL (visible para cualquier miembro).
 *   - team_ids=[...]: N filas (1 por team).
 *
 * El form impone que sea club_wide XOR team_ids con al menos 1 entrada.
 */

const globalAnnouncementSchema = z
  .object({
    title: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(120)),
    body: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(2000)),
    pinned: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) =>
        typeof v === 'string' ? v === 'on' || v === 'true' : Boolean(v),
      ),
    expires_at: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (s.length === 0) return null;
        return s;
      })
      .refine(
        (v) => {
          if (v === null) return true;
          const t = Date.parse(v);
          return Number.isFinite(t) && t > Date.now();
        },
        { message: 'expires_at_must_be_future' },
      ),
    audience_kind: z.enum(['club_wide', 'teams']),
    team_ids: z.array(z.string().uuid()).optional().default([]),
  })
  .refine(
    (v) => v.audience_kind === 'club_wide' || v.team_ids.length > 0,
    { message: 'audience_required' },
  );

export type CreateGlobalAnnouncementResult = {
  ok?: { created_count: number };
  error?: 'forbidden' | 'invalid_payload' | 'generic' | 'audience_required';
};

const GLOBAL_AUTHOR_ROLES: ReadonlyArray<string> = ['admin_club', 'coordinador'];

/**
 * Solo admin / coordinador. El principal del club NO puede crear anuncios
 * club-wide ni multi-team — su scope es su(s) team(s) y usa la ruta
 * /equipos/[teamId]/anuncios.
 */
export async function createGlobalAnnouncement(
  locale: string,
  input: unknown,
): Promise<CreateGlobalAnnouncementResult> {
  const parsed = globalAnnouncementSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  if (!GLOBAL_AUTHOR_ROLES.includes(ctx.activeClub.role)) {
    return { error: 'forbidden' };
  }

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Construir las filas a insertar.
  const baseRow = {
    club_id: clubId,
    author_profile_id: ctx.user.id,
    title: parsed.data.title,
    body: parsed.data.body,
    pinned: parsed.data.pinned,
    expires_at: parsed.data.expires_at,
  };

  const rows = parsed.data.audience_kind === 'club_wide'
    ? [{ ...baseRow, team_id: null as string | null }]
    : parsed.data.team_ids.map((teamId) => ({ ...baseRow, team_id: teamId }));

  // Validar que los teams seleccionados pertenecen al club activo.
  if (parsed.data.audience_kind === 'teams') {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, categories!inner(club_id)')
      .in('id', parsed.data.team_ids);
    type TeamRow = { id: string; categories: { club_id: string } };
    const teams = (teamRows ?? []) as unknown as TeamRow[];
    if (
      teams.length !== parsed.data.team_ids.length
      || teams.some((t) => t.categories.club_id !== clubId)
    ) {
      return { error: 'forbidden' };
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('announcements')
    .insert(rows)
    .select('id');

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr, {
      tags: { feature: 'announcements', step: 'create_global' },
      extra: {
        audience_kind: parsed.data.audience_kind,
        team_count: parsed.data.team_ids.length,
        club_id: clubId,
      },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/anuncios`);
  for (const r of rows) {
    if (r.team_id) revalidatePath(`/${locale}/equipos/${r.team_id}/anuncios`);
  }

  return { ok: { created_count: inserted?.length ?? rows.length } };
}

/**
 * Borrar un anuncio desde la vista de detalle (/anuncios/[id]).
 * RLS exige autor o admin/coord/principal del club. Tras borrar revalidamos
 * /anuncios y, si era team-bound, también /equipos/[teamId]/anuncios.
 */
export async function deleteAnnouncementFromDetail(
  locale: string,
  announcementId: string,
): Promise<{ ok?: true; error?: 'forbidden' | 'not_found' | 'generic' }> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: existing } = await supabase
    .from('announcements')
    .select('id, team_id, club_id')
    .eq('id', announcementId)
    .maybeSingle();
  if (!existing) return { error: 'not_found' };
  if (existing.club_id !== ctx.activeClub.club.id) return { error: 'forbidden' };

  const { error: delErr, count } = await supabase
    .from('announcements')
    .delete({ count: 'exact' })
    .eq('id', announcementId);

  if (delErr) {
    if (delErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(delErr, {
      tags: { feature: 'announcements', step: 'delete_detail' },
      extra: { announcement_id: announcementId },
    });
    return { error: 'generic' };
  }
  if (count === 0) return { error: 'forbidden' };

  revalidatePath(`/${locale}/anuncios`);
  revalidatePath(`/${locale}`);
  if (existing.team_id) {
    revalidatePath(`/${locale}/equipos/${existing.team_id}/anuncios`);
  }
  return { ok: true };
}
