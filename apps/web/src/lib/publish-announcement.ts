import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  publishAnnouncementFromClient,
  type Database,
  type PublishAnnouncementInput,
  type PublishAnnouncementOutcome,
} from '@misterfc/core';
import { emitNotificationFanOut } from '@/lib/notify-bus';

export type { PublishAnnouncementInput, PublishAnnouncementOutcome };

/**
 * O2-10b-1b — Wrapper web de publicar anuncio (core). Único punto que inyecta el
 * FAN-OUT real (`notifyTeamAnnouncement`: resuelve destinatarios con el cliente del
 * usuario + emite campana + push blindado O2-4 con service-role) y el logger de
 * Sentry. Lo usan la Server Action web (cookie) y el route handler nativo (bearer):
 * misma lógica, mismo fan-out, mismo logging. Extraído del inline de la action web
 * SIN cambiar su comportamiento.
 *
 * El fan-out va como callback → el insert ocurre como el usuario (RLS = gate) y el
 * service-role solo entra en este callback, DESPUÉS de publicar con éxito.
 */

type Supa = SupabaseClient<Database>;

/**
 * F5.7 — Notifica a los miembros del team (jugadores + familia) de un anuncio nuevo.
 * Resuelve destinatarios con el cliente del USUARIO (RLS) — comportamiento idéntico al
 * inline previo — y hace el fan-out (campana + push) con service-role vía notify-bus.
 */
async function notifyTeamAnnouncement(
  supabase: Supa,
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

const sentryLog =
  (feature: string) =>
  (error: unknown, step: string, extra: Record<string, unknown>) =>
    Sentry.captureException(error, { tags: { feature, step }, extra });

export function publishAnnouncementWeb(
  supabase: Supa,
  input: PublishAnnouncementInput,
): Promise<PublishAnnouncementOutcome> {
  return publishAnnouncementFromClient(
    supabase,
    input,
    (announcementId) =>
      notifyTeamAnnouncement(
        supabase,
        announcementId,
        input.teamId,
        input.title,
        input.body,
        input.locale,
      ),
    sentryLog('announcements'),
  );
}
