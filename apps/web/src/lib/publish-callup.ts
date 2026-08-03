import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createSupabaseAdminClient,
  publishCallupFromClient,
  republishCallupFromClient,
  type Database,
  type PublishCallupOutcome,
  type RepublishCallupOutcome,
} from '@misterfc/core';
import { emitNotificationFanOut } from '@/lib/notify-bus';

export type { PublishCallupOutcome, RepublishCallupOutcome };

/**
 * O2-7b-2 — Wrapper web de publicar/republicar convocatoria (core). Único punto que
 * inyecta el FAN-OUT real (`notifyCallup`: resuelve destinatarios con service-role
 * —Bug CC— y emite campana + push blindado O2-4) y el logger de Sentry. Lo usan la
 * Server Action web (cookie) y el route handler nativo (bearer): misma lógica, mismo
 * fan-out, mismo logging. Extraído SIN cambiar el comportamiento web.
 *
 * El fan-out se pasa como callback → el cambio de estado (published_at) ocurre como
 * el usuario (RLS = gate) y el service-role solo entra en este callback, DESPUÉS de
 * publicar con éxito.
 */

type CallupEvent = {
  id: string;
  team_id: string;
  title: string;
  opponent_name: string | null;
  starts_at: string;
};

/**
 * Destinatarios de una notificación de convocatoria: profiles vinculados (vía
 * player_accounts) a jugadores del roster activo a la fecha del partido + subidos.
 * Usa el ADMIN client (service-role): la resolución NO debe quedar limitada por la
 * RLS del cuerpo técnico sobre player_accounts (Bug CC).
 */
async function callupRecipients(
  eventId: string,
): Promise<{ event: CallupEvent; userIds: string[] } | null> {
  const admin = createSupabaseAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, team_id, title, opponent_name, starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!event?.team_id) return null;

  const eventDate = event.starts_at.slice(0, 10);
  const { data: tms } = await admin
    .from('team_members')
    .select('player_id, joined_at, left_at')
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type TM = { player_id: string; joined_at: string; left_at: string | null };
  const rosterIds = (tms ?? [])
    .map((r) => r as unknown as TM)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => r.player_id);

  // D2.1 — los jugadores SUBIDOS a este evento cuentan como convocados → reciben
  // la notificación como un miembro más.
  const { data: promo } = await admin
    .from('player_promotions')
    .select('player_id')
    .eq('event_id', eventId);
  const allPlayerIds = Array.from(
    new Set([...rosterIds, ...(promo ?? []).map((r) => r.player_id)]),
  );
  if (allPlayerIds.length === 0) return null;

  const { data: pas } = await admin
    .from('player_accounts')
    .select('profile_id')
    .in('player_id', allPlayerIds);
  const userIds = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (userIds.length === 0) return null;

  return { event: event as CallupEvent, userIds };
}

/**
 * Emite la notificación de convocatoria publicada (`callup_published`) o actualizada
 * (`callup_updated`, Bug D/G). `dedupeToken` distingue cada publicación: en
 * re-publicaciones se pasa un token único para que la notificación NO quede
 * deduplicada con la anterior. Reutiliza `emitNotificationFanOut` (campana + push
 * blindado O2-4): un fallo de Expo no rompe la publicación.
 */
export async function notifyCallup(
  eventId: string,
  kind: 'callup_published' | 'callup_updated',
  dedupeToken?: string,
): Promise<void> {
  const r = await callupRecipients(eventId);
  if (!r) return;
  const { event, userIds } = r;

  const oppLabel = event.opponent_name ?? '';
  const matchLabel = oppLabel ? `${event.title} vs ${oppLabel}` : event.title;
  const prefixEs =
    kind === 'callup_updated' ? 'Convocatoria actualizada' : 'Convocatoria';
  const title = `${prefixEs}: ${matchLabel}`;
  const body = `Partido el ${new Date(event.starts_at).toLocaleString('es-ES')}`;
  const base = dedupeToken
    ? `${kind}:${eventId}:${dedupeToken}`
    : `${kind}:${eventId}`;

  await emitNotificationFanOut(
    userIds.map((u) => ({ user_id: u })),
    {
      type: kind,
      in_app_payload: {
        event_id: eventId,
        deep_link: `/es/convocatorias/${eventId}`,
      },
      push_payload: {
        title,
        body,
        deep_link: `/es/convocatorias/${eventId}`,
        tag: `${kind}:${eventId}`,
      },
      dedupe_base_prefix: base,
    },
  );
}

const sentryLog =
  (feature: string) =>
  (error: unknown, step: string, extra: Record<string, unknown>) =>
    Sentry.captureException(error, { tags: { feature, step }, extra });

export function publishCallupWeb(
  supabase: SupabaseClient<Database>,
  input: unknown,
): Promise<PublishCallupOutcome> {
  return publishCallupFromClient(supabase, input, notifyCallup, sentryLog('callups'));
}

export function republishCallupWeb(
  supabase: SupabaseClient<Database>,
  eventId: string,
): Promise<RepublishCallupOutcome> {
  return republishCallupFromClient(
    supabase,
    eventId,
    notifyCallup,
    sentryLog('callups'),
  );
}
