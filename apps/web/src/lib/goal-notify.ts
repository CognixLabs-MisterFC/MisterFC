/**
 * F7B-P1 — Push de GOL a los seguidores del equipo.
 *
 * Se llama desde el directo del staff justo tras confirmarse CUALQUIER gol del
 * partido (nuestro o del rival; gol de jugada o penalti marcado). El seguidor
 * quiere enterarse de todos los goles. Resuelve el marcador actual (computeScore
 * sobre match_events → refleja el gol recién registrado, marque quien marque),
 * el nombre del equipo/rival y los seguidores (team_follows), y emite el fan-out.
 * NUNCA lanza: un fallo de push jamás debe tumbar el registro del gol.
 *
 * Lee con service_role (createSupabaseAdminClient) porque los seguidores son de
 * OTROS usuarios (la RLS de team_follows solo deja ver las filas propias).
 */

import {
  createSupabaseAdminClient,
  computeScore,
  formatGoalPush,
  resolveGoalRecipients,
  type ScoreEvent,
} from '@misterfc/core';
import { emitNotificationFanOut } from './notify-bus';

type EventRow = {
  team_id: string | null;
  opponent_name: string | null;
  teams: { name: string } | null;
};

type ScoreRow = {
  side: 'own' | 'rival';
  type: string;
  metadata: { outcome?: string } | null;
};

/**
 * @param eventId   Partido (events.id) donde se marcó el gol.
 * @param goalRowId id de la fila match_events del gol → dedupe idempotente
 *                  (reintentos del server action no re-notifican).
 * @param recorderProfileId usuario que registró el gol (se excluye del fan-out).
 */
export async function emitGoalPush(params: {
  eventId: string;
  goalRowId: string;
  recorderProfileId: string;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();

    // Equipo (nombre) + rival del partido.
    const { data: evRaw } = await admin
      .from('events')
      .select('team_id, opponent_name, teams!inner(name)')
      .eq('id', params.eventId)
      .maybeSingle();
    const ev = evRaw as unknown as EventRow | null;
    const teamId = ev?.team_id ?? null;
    if (!teamId) return; // partido sin equipo (no debería estar en directo).
    const teamName = ev?.teams?.name ?? '';

    // Seguidores del equipo (cruza usuarios) → destinatarios, sin el que graba.
    const { data: followers } = await admin
      .from('team_follows')
      .select('profile_id')
      .eq('team_id', teamId);
    const recipients = resolveGoalRecipients(
      (followers ?? []).map((f) => f.profile_id as string),
      params.recorderProfileId,
    );
    if (recipients.length === 0) return;

    // Marcador actual autoritativo: computeScore sobre TODOS los match_events.
    const { data: evtRows } = await admin
      .from('match_events')
      .select('side, type, metadata')
      .eq('event_id', params.eventId);
    const scoreEvents: ScoreEvent[] = ((evtRows ?? []) as ScoreRow[]).map((e) => ({
      side: e.side,
      type: e.type,
      outcome: e.metadata?.outcome ?? null,
    }));
    const score = computeScore(scoreEvents);

    const { title, body } = formatGoalPush({
      teamName,
      opponentName: ev?.opponent_name ?? null,
      own: score.own,
      rival: score.rival,
    });
    const deepLink = `/es/directos/${params.eventId}`;

    await emitNotificationFanOut(
      recipients.map((user_id) => ({ user_id })),
      {
        type: 'goal',
        in_app_payload: {
          event_id: params.eventId,
          team_id: teamId,
          deep_link: deepLink,
        },
        push_payload: {
          title,
          body,
          deep_link: deepLink,
          // tag por partido: colapsa avisos consecutivos del mismo directo.
          tag: `goal:${params.eventId}`,
        },
        // dedupe por fila de gol: reintentos idempotentes, cada gol notifica una vez.
        dedupe_base_prefix: `goal:${params.goalRowId}`,
      },
    );
  } catch {
    // Silencioso: el push jamás debe romper el registro del gol.
  }
}
