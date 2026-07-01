'use server';

/**
 * D2 — "Subir jugadores" a equipos superiores: acciones de la UI de alta.
 *
 *   · loadPromotionCandidates(eventId) — jugadores elegibles (equipo base
 *     inferior) vía RPC promotion_candidates (gated por user_can_manage_callup).
 *   · loadPromotionConflicts(eventId, playerId) — eventos que solapan la franja
 *     (aviso, no bloqueo) vía RPC promotion_conflicts.
 *   · promotePlayer(eventId, playerId) — inserta en player_promotions (el trigger
 *     de D1 valida "solo superior" y deriva kind); tras el alta emite la
 *     notificación player_promoted a la familia/jugador. NO bloquea por conflicto.
 *
 * El gate real es la RLS de player_promotions (INSERT = user_can_manage_callup) y
 * las RPCs; aquí solo mapeamos errores del trigger a claves i18n.
 */

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type PromotionCandidate = {
  player_id: string;
  first_name: string;
  last_name: string;
  dorsal: number | null;
  base_team_name: string | null;
  base_category_name: string | null;
};

export type PromotionConflict = {
  event_id: string;
  title: string;
  team_name: string | null;
  starts_at: string;
  ends_at: string | null;
  source: 'team' | 'promotion';
};

export type PromotionEventInfo = {
  title: string;
  team_name: string | null;
  starts_at: string;
  /** Derivado de event.type: training→train, match/friendly/tournament→match. */
  kind: 'train' | 'match' | null;
};

function kindFromType(type: string | null | undefined): 'train' | 'match' | null {
  if (type === 'training') return 'train';
  if (type === 'match' || type === 'friendly' || type === 'tournament') return 'match';
  return null;
}

/** Opciones del diálogo: contexto del evento + candidatos elegibles. */
export async function loadPromotionCandidates(
  eventId: string,
): Promise<
  | { error: 'generic'; event?: undefined; candidates?: undefined }
  | { error?: undefined; event: PromotionEventInfo; candidates: PromotionCandidate[] }
> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());

  const { data: ev } = await supabase
    .from('events')
    .select('title, starts_at, type, teams(name)')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return { error: 'generic' };

  const { data, error } = await supabase.rpc('promotion_candidates', {
    p_event_id: eventId,
  });
  if (error) return { error: 'generic' };

  const teamName =
    (ev as unknown as { teams: { name: string } | null }).teams?.name ?? null;

  return {
    event: {
      title: ev.title as string,
      team_name: teamName,
      starts_at: ev.starts_at as string,
      kind: kindFromType(ev.type as string),
    },
    candidates: (data ?? []) as PromotionCandidate[],
  };
}

/** Solapes del jugador con la franja del evento destino (aviso, no bloqueo). */
export async function loadPromotionConflicts(
  eventId: string,
  playerId: string,
): Promise<{ conflicts: PromotionConflict[] }> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const { data, error } = await supabase.rpc('promotion_conflicts', {
    p_event_id: eventId,
    p_player_id: playerId,
  });
  if (error) return { conflicts: [] };
  return { conflicts: (data ?? []) as PromotionConflict[] };
}

export type PromotePlayerState =
  | { success: true }
  | {
      success: false;
      error:
        | 'invalid_input'
        | 'forbidden'
        | 'not_superior'
        | 'not_promotable'
        | 'cross_club'
        | 'already'
        | 'db';
    };

/** Mapea el error del trigger/RLS a una clave i18n. */
function mapPromotePgErr(message: string, code?: string): PromotePlayerState {
  if (code === '42501') return { success: false, error: 'forbidden' };
  if (code === '23505') return { success: false, error: 'already' };
  if (message.includes('promotion_target_not_superior'))
    return { success: false, error: 'not_superior' };
  if (message.includes('event_type_not_promotable'))
    return { success: false, error: 'not_promotable' };
  if (message.includes('player_cross_club'))
    return { success: false, error: 'cross_club' };
  return { success: false, error: 'db' };
}

export async function promotePlayer(
  eventId: string,
  playerId: string,
): Promise<PromotePlayerState> {
  if (!eventId || !playerId) return { success: false, error: 'invalid_input' };

  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'forbidden' };

  // team_id/club_id/kind se derivan del evento (el trigger de D1 los reescribe de
  // forma autoritativa; los pasamos para satisfacer los NOT NULL del tipo Insert).
  const { data: ev } = await supabase
    .from('events')
    .select('team_id, club_id, type')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || !ev.team_id) return { success: false, error: 'invalid_input' };
  const kind = kindFromType(ev.type as string);
  if (!kind) return { success: false, error: 'not_promotable' };

  const { error } = await supabase.from('player_promotions').insert({
    event_id: eventId,
    player_id: playerId,
    team_id: ev.team_id as string,
    club_id: ev.club_id as string,
    kind,
  });
  if (error) return mapPromotePgErr(error.message, error.code);

  await notifyPlayerPromoted(eventId, playerId);

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true };
}

/**
 * Emite player_promoted a la FAMILIA/jugador del jugador subido (player_accounts).
 * Aviso propio (modelo B): resolución de destinatarios con admin client, igual
 * que notifyPlayShared. El texto del feed se construye por-locale en el mapper
 * (home.feed.player_promoted_*) a partir del payload; el push lleva es fijo (como
 * el resto del proyecto).
 */
async function notifyPlayerPromoted(eventId: string, playerId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: ev } = await admin
    .from('events')
    .select('starts_at, type, teams(name)')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return;

  const teamName =
    (ev as unknown as { teams: { name: string } | null }).teams?.name ?? '';
  const kind = kindFromType(ev.type as string) ?? 'match';
  const startsAt = ev.starts_at as string;

  const { data: pas } = await admin
    .from('player_accounts')
    .select('profile_id')
    .eq('player_id', playerId);
  const userIds = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (userIds.length === 0) return;

  const verbEs = kind === 'train' ? 'entrenar' : 'jugar';
  const title = teamName ? `Convocado con el ${teamName}` : 'Convocado con un equipo superior';
  const body = `Has sido convocado a ${verbEs} con el ${teamName} el ${new Date(
    startsAt,
  ).toLocaleString('es-ES')}`.trim();

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    userIds.map((u) => ({ user_id: u })),
    {
      type: 'player_promoted',
      in_app_payload: {
        player_id: playerId,
        event_id: eventId,
        team_name: teamName,
        kind,
        starts_at: startsAt,
        deep_link: '/es/calendario',
      },
      push_payload: {
        title,
        body,
        deep_link: '/es/calendario',
        tag: `player_promoted:${eventId}:${playerId}`,
      },
      dedupe_base_prefix: `player_promoted:${eventId}:${playerId}:${Date.now()}`,
    },
  );
}
