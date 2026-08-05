import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markHolidayFromClient,
  unmarkHolidayFromClient,
  decideEventApprovalFromClient,
  TIMEZONE_OLA1,
  type Database,
  type HolidayAffectedEvent,
  type HolidayOutcome,
  type ApprovalOutcome,
  type ApprovalDecision,
} from '@misterfc/core';
import { emitNotificationFanOut } from '@/lib/notify-bus';

/**
 * O2-11c-1 — Wrapper web de las ACCIONES de festivos (core). Único punto que inyecta
 * el FAN-OUT real (resuelve destinatarios con el cliente del USUARIO + emite campana
 * + push blindado O2-4 con service-role vía notify-bus) y el logger de Sentry. Lo
 * usan la Server Action web (cookie) y el route handler nativo (bearer): misma RPC,
 * mismo fan-out, mismo logging. Extraído del inline de `calendario/actions.ts` (F14F-2/
 * F14F-4) SIN cambiar su comportamiento. El fan-out va DESPUÉS de la RPC (core lo
 * llama como callback, tras el éxito).
 */

type Supa = SupabaseClient<Database>;

const TZ = TIMEZONE_OLA1;

/**
 * F14F-2 — destinatarios del aviso de festivo para un equipo: ENTRENADORES
 * (team_staff activo) ∪ JUGADORES/FAMILIAS (team_members activo → player_accounts).
 * Deduplicado por profile_id. Se resuelve con el cliente del USUARIO (RLS).
 */
async function holidayTeamRecipients(supabase: Supa, teamId: string): Promise<string[]> {
  const [{ data: staffRows }, { data: tms }] = await Promise.all([
    supabase
      .from('team_staff')
      .select('memberships!inner(profile_id)')
      .eq('team_id', teamId)
      .is('left_at', null),
    supabase
      .from('team_members')
      .select('player_id')
      .eq('team_id', teamId)
      .is('left_at', null),
  ]);

  const coachIds = ((staffRows ?? []) as unknown as {
    memberships: { profile_id: string };
  }[]).map((r) => r.memberships.profile_id);

  const playerIds = (tms ?? []).map((r) => r.player_id);
  let familyIds: string[] = [];
  if (playerIds.length > 0) {
    const { data: pas } = await supabase
      .from('player_accounts')
      .select('profile_id')
      .in('player_id', playerIds);
    familyIds = (pas ?? []).map((r) => r.profile_id).filter(Boolean) as string[];
  }

  return Array.from(new Set([...coachIds, ...familyIds]));
}

/**
 * F14F-2 — emite el aviso (cancelación/reactivación por festivo) a los destinatarios
 * de cada equipo afectado. best-effort (notify-bus blindado): no bloquea la acción.
 */
async function notifyHolidayEvents(
  supabase: Supa,
  events: HolidayAffectedEvent[],
  kind: 'cancelled' | 'reinstated',
  reason: string | null,
): Promise<void> {
  const withTeam = events.filter((e) => e.team_id);
  if (withTeam.length === 0) return;

  const type = kind === 'cancelled' ? 'training_cancelled' : 'training_reinstated';

  for (const ev of withTeam) {
    const recipients = await holidayTeamRecipients(supabase, ev.team_id as string);
    if (recipients.length === 0) continue;

    const whenEs = new Date(ev.starts_at).toLocaleString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
    const pushTitle =
      kind === 'cancelled'
        ? `Entrenamiento cancelado: ${ev.title}`
        : `Entrenamiento reactivado: ${ev.title}`;
    const pushBody =
      kind === 'cancelled' && reason ? `Instalaciones cerradas (${reason}) · ${whenEs}` : whenEs;

    await emitNotificationFanOut(
      recipients.map((u) => ({ user_id: u })),
      {
        type,
        in_app_payload: {
          event_id: ev.event_id,
          team_id: ev.team_id,
          title: ev.title,
          starts_at: ev.starts_at,
          deep_link: '/calendario',
        },
        push_payload: {
          title: pushTitle,
          body: pushBody,
          deep_link: '/es/calendario',
          tag: `${type}:${ev.event_id}`,
        },
        dedupe_base_prefix: `${type}:${ev.event_id}:${ev.starts_at}`,
      },
    );
  }
}

/** F14F-4 — avisa al CREADOR del resultado (aprobado/rechazado). */
async function notifyApprovalDecision(ev: ApprovalDecision): Promise<void> {
  const type = ev.status === 'approved' ? 'training_approved' : 'training_rejected';
  const whenEs = new Date(ev.starts_at).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
  await emitNotificationFanOut([{ user_id: ev.created_by }], {
    type,
    in_app_payload: {
      event_id: ev.event_id,
      team_id: ev.team_id,
      title: ev.title,
      starts_at: ev.starts_at,
      deep_link: '/calendario',
    },
    push_payload: {
      title:
        ev.status === 'approved'
          ? `Entrenamiento en festivo aprobado: ${ev.title}`
          : `Entrenamiento en festivo rechazado: ${ev.title}`,
      body: whenEs,
      deep_link: '/es/calendario',
      tag: `${type}:${ev.event_id}`,
    },
    dedupe_base_prefix: `${type}:${ev.event_id}:${ev.starts_at}`,
  });
}

const sentryLog =
  (feature: string) =>
  (error: unknown, step: string, extra: Record<string, unknown>) =>
    Sentry.captureException(error, { tags: { feature, step }, extra });

/** Marca festivo (RPC como el usuario) + fan-out DESPUÉS. */
export function markHolidayWeb(
  supabase: Supa,
  clubId: string,
  date: string,
  reason: string,
): Promise<HolidayOutcome> {
  return markHolidayFromClient(
    supabase,
    clubId,
    date,
    reason,
    (events, kind, r) => notifyHolidayEvents(supabase, events, kind, r),
    sentryLog('holidays'),
  );
}

/** Desmarca festivo (RPC como el usuario) + fan-out DESPUÉS. */
export function unmarkHolidayWeb(supabase: Supa, holidayId: string): Promise<HolidayOutcome> {
  return unmarkHolidayFromClient(
    supabase,
    holidayId,
    (events, kind, r) => notifyHolidayEvents(supabase, events, kind, r),
    sentryLog('holidays'),
  );
}

/** Aprueba/rechaza training en festivo (RPC como el usuario) + fan-out DESPUÉS. */
export function decideEventApprovalWeb(
  supabase: Supa,
  eventId: string,
  approve: boolean,
  reason: string | null,
): Promise<ApprovalOutcome> {
  return decideEventApprovalFromClient(
    supabase,
    eventId,
    approve,
    reason,
    (decision) => notifyApprovalDecision(decision),
    sentryLog('holidays'),
  );
}
