'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import * as Sentry from '@sentry/nextjs';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// JR-2 (ADR-0019) — Playbook por equipo: el STAFF DEL EQUIPO selecciona jugadas
// PUBLICADAS del banco del club hacia su equipo (team_plays) y decide cuáles
// comparte con la familia. El gate real es la RLS de team_plays (JR-0): añadir/
// quitar/togglear = user_is_staff_of_team; añadir exige jugada publicada del club.
// Al compartir con la familia se reusa la notificación F13.6 (tipo play_published).
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic';

export type TeamPlayActionState = {
  error?: ActionError;
  success?: boolean;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  if (code === '23505') return 'generic'; // ya estaba en el equipo (UNIQUE)
  return 'generic';
}

function revalidateTeamPlaybook(teamId: string) {
  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}/jugadas`, 'page');
  revalidatePath('/[locale]/(authenticated)/equipos/[teamId]/jugadas', 'page');
  revalidatePath('/[locale]/(authenticated)/mi-equipo', 'page');
}

const addSchema = z.object({ teamId: z.string().uuid(), playId: z.string().uuid() });
const removeSchema = addSchema;
const shareSchema = z.object({
  teamId: z.string().uuid(),
  playId: z.string().uuid(),
  shared: z.boolean(),
});

/** Añade una jugada PUBLICADA del banco al playbook del equipo. club_id y added_by
 *  los deriva el trigger team_plays_validate (JR-0). RLS = gate (staff del equipo +
 *  jugada publicada del club). */
export async function addPlayToTeam(input: unknown): Promise<TeamPlayActionState> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // club_id lo RE-DERIVA el trigger team_plays_validate desde el equipo (JR-0); se
  // envía el del club activo solo para satisfacer el tipo Insert (no es la fuente).
  const { error } = await supabase.from('team_plays').insert({
    team_id: parsed.data.teamId,
    play_id: parsed.data.playId,
    club_id: ctx.activeClub.club.id,
  });

  if (error) return { error: mapPgErr(error.code) };

  revalidateTeamPlaybook(parsed.data.teamId);
  return { success: true };
}

/** Quita una jugada del playbook del equipo. RLS = gate (staff del equipo). */
export async function removePlayFromTeam(input: unknown): Promise<TeamPlayActionState> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('team_plays')
    .delete()
    .eq('team_id', parsed.data.teamId)
    .eq('play_id', parsed.data.playId);

  if (error) return { error: mapPgErr(error.code) };

  revalidateTeamPlaybook(parsed.data.teamId);
  return { success: true };
}

/**
 * Togglea shared_with_family de una jugada del playbook del equipo. Al ACTIVARLO,
 * notifica a la familia/jugador del equipo (reusa play_published, F13.6; re-notifica
 * en cada compartir, opción B). RLS = gate (staff del equipo). `locale` solo para el
 * texto/deep-link de la notificación.
 */
export async function setPlayShared(input: unknown, locale: string): Promise<TeamPlayActionState> {
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { teamId, playId, shared } = parsed.data;

  const { data: updated, error } = await supabase
    .from('team_plays')
    .update({ shared_with_family: shared })
    .eq('team_id', teamId)
    .eq('play_id', playId)
    .select('play_id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  // Al compartir (no al dejar de compartir): avisa a la familia del equipo.
  if (shared) {
    try {
      await notifyPlayShared(teamId, playId, locale);
    } catch (notifyErr) {
      Sentry.captureException(notifyErr, {
        tags: { feature: 'plays', step: 'notify_share' },
        extra: { team_id: teamId, play_id: playId },
      });
    }
  }

  revalidateTeamPlaybook(teamId);
  return { success: true };
}

/**
 * Notifica a jugadores/familias del equipo que una jugada se ha compartido (F13.6,
 * tipo play_published). Mismo patrón que las convocatorias: team_members activos →
 * player_accounts → profile_ids → emitNotificationFanOut. Usa el cliente ADMIN para
 * resolver destinatarios (la RLS del staff sobre player_accounts podría ocultarlos).
 * dedupe único por (jugada, equipo, instante) → re-notifica en cada compartir (B).
 */
async function notifyPlayShared(teamId: string, playId: string, locale: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: tms } = await admin
    .from('team_members')
    .select('player_id')
    .eq('team_id', teamId)
    .is('left_at', null);
  const playerIds = (tms ?? []).map((r) => r.player_id);
  if (playerIds.length === 0) return;

  const { data: pas } = await admin
    .from('player_accounts')
    .select('profile_id')
    .in('player_id', playerIds);
  const recipientUserIds = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (recipientUserIds.length === 0) return;

  const { data: play } = await admin.from('plays').select('name').eq('id', playId).maybeSingle();

  const tNotify = await getTranslations({ locale, namespace: 'jugadas.notify' });
  const tJ = await getTranslations({ locale, namespace: 'jugadas' });
  const name = (play?.name as string | null) ?? tJ('untitled');
  const title = tNotify('title');
  const body = tNotify('body', { name });
  const deepLink = `/${locale}/mi-equipo/jugadas/${playId}`;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipientUserIds.map((u) => ({ user_id: u })),
    {
      type: 'play_published',
      in_app_payload: { play_id: playId, team_id: teamId, deep_link: deepLink },
      push_payload: { title, body, deep_link: deepLink, tag: `play:${playId}` },
      // Único por (jugada, equipo) + instante → vuelve a avisar en cada compartir (B).
      dedupe_base_prefix: `play_published:${playId}:${teamId}:${Date.now()}`,
    },
  );
}
