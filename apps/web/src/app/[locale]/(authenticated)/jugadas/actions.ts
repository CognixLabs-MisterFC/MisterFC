'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import * as Sentry from '@sentry/nextjs';
import { parsePlay, emptyPlay, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F13.2 — Crear/editar jugadas. La RLS/trigger de 13.1b son el gate real; aquí
// hay pre-checks de autoridad para devolver errores claros. La forma del jsonb la
// valida `parsePlay` (core 13.1a) antes de persistir. Sin ciclo de estados (D2).
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic';

export type PlayActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  return 'generic';
}

function revalidatePlays() {
  revalidatePath('/[locale]/(authenticated)/jugadas', 'page');
  revalidatePath('/[locale]/(authenticated)/jugadas/[id]/editar', 'page');
}

const createPlaySchema = z.object({
  team_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

const updatePlaySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).nullable(),
  description: z.string().trim().max(2000).nullable(),
  visibility: z.enum(['staff', 'team']),
  play: z.unknown(), // forma fuerte = parsePlay (abajo)
  locale: z.string().min(2).max(5), // para deep_link + texto de la notificación
});

/**
 * Crea una jugada (creación directa) sembrando 1 frame vacío con `emptyPlay()` y
 * redirige al editor (devuelve el id). El gate real es la RLS; el pre-check
 * `user_can_create_plays` (team-scoped) da un error claro si no hay autoridad.
 */
export async function createPlay(input: unknown): Promise<PlayActionState> {
  const parsed = createPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: canCreate } = await supabase.rpc('user_can_create_plays', {
    p_team_id: parsed.data.team_id,
  });
  if (!canCreate) return { error: 'forbidden' };

  const { data: created, error } = await supabase
    .from('plays')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: ctx.activeClub.club.id, // el trigger lo deriva del team igualmente
      team_id: parsed.data.team_id,
      name: parsed.data.name,
      play: emptyPlay(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidatePlays();
  return { success: true, id };
}

/**
 * Guarda la jugada: cabecera (name/description/visibility) + el jsonb `play`. El
 * `team_id` es INMUTABLE (trigger 13.1b) → no se toca aquí. La forma del jsonb se
 * valida con `parsePlay`; la autoría/edición la gatea la RLS (autor∪admin/coord).
 */
export async function updatePlay(input: unknown): Promise<PlayActionState> {
  const parsed = updatePlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const play = parsePlay(parsed.data.play);
  if (!play.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('plays')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      visibility: parsed.data.visibility,
      play: play.data,
    })
    .eq('id', parsed.data.id)
    .select('id, team_id, name, visibility')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  // F13.6 (Parte B) — al quedar en 'team' (publicar), notifica a jugadores/
  // familias del equipo. Decisión B: re-notifica en CADA publicación (puede haber
  // cambios), por eso el dedupe_base lleva un token único de tiempo → nunca se
  // colapsa con publicaciones anteriores. No bloquea el guardado si falla.
  if (updated.visibility === 'team') {
    try {
      await notifyPlayPublished(
        supabase,
        updated.id as string,
        updated.team_id as string,
        (updated.name as string | null) ?? null,
        parsed.data.locale,
      );
    } catch (notifyErr) {
      Sentry.captureException(notifyErr, {
        tags: { feature: 'plays', step: 'notify_publish' },
        extra: { play_id: parsed.data.id },
      });
    }
  }

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

/**
 * F13.6 — Notifica a jugadores/familias del equipo que una jugada está publicada.
 * Mismo patrón que los anuncios de equipo (F5.7): team_members activos →
 * player_accounts → profile_ids → emitNotificationFanOut. El texto (push) se
 * localiza con el locale de quien publica. dedupe_base único por publicación
 * (token de tiempo) para re-notificar siempre (Parte B, a propósito).
 */
async function notifyPlayPublished(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  playId: string,
  teamId: string,
  playName: string | null,
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

  const t = await getTranslations({ locale, namespace: 'jugadas.notify' });
  const name = playName ?? (await getTranslations({ locale, namespace: 'jugadas' }))('untitled');
  const title = t('title');
  const body = t('body', { name });
  const deepLink = `/${locale}/mi-equipo/jugadas/${playId}`;
  const token = String(Date.now()); // re-notifica en cada publicación (B)

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipientUserIds.map((u) => ({ user_id: u })),
    {
      type: 'play_published',
      in_app_payload: { play_id: playId, team_id: teamId, deep_link: deepLink },
      push_payload: { title, body, deep_link: deepLink, tag: `play:${playId}` },
      dedupe_base_prefix: `play_published:${playId}:${token}`,
    },
  );
}

/** Borra una jugada (autor∪admin/coord, gate = RLS). */
export async function deletePlay(input: unknown): Promise<PlayActionState> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('plays').delete().eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.code) };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}
