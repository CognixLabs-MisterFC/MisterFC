/**
 * O2-11c-1 — Orquestadores de las ACCIONES de festivos (FromClient), extraídos del
 * inline de `apps/web/.../calendario/actions.ts` (F14F-2/F14F-4).
 *
 * Cada uno: llama la RPC COMO EL USUARIO (el gate `user_is_admin_or_director` vive
 * DENTRO de la RPC → un no autorizado obtiene `forbidden`), mapea los códigos de
 * error conocidos y, SOLO tras el éxito, invoca el callback `notify` inyectado (el
 * FAN-OUT service-role: recipients + notify-bus + textos, que el caller aporta —
 * core no depende del bus ni de los strings web). El fan-out va DESPUÉS y su fallo
 * NO rompe la acción (try/catch + logger), como el patrón de anuncios (10b-1b).
 *
 * Los usan la Server Action web (cliente cookie) y el route handler nativo (cliente
 * bearer): misma RPC, mismo fan-out, mismo logging. La action web queda wrapper.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

/** Evento afectado por un festivo (cancelado o reactivado) — lo devuelve la RPC. */
export type HolidayAffectedEvent = {
  event_id: string;
  team_id: string | null;
  title: string;
  starts_at: string;
};

export type HolidayErrorCode =
  | 'forbidden'
  | 'no_session'
  | 'already_holiday'
  | 'reason_required'
  | 'not_found'
  | 'db';

export type HolidayOutcome =
  | { success: true; holidayId: string }
  | { success: false; error: HolidayErrorCode };

export type ApprovalErrorCode =
  | 'forbidden'
  | 'no_session'
  | 'not_found'
  | 'not_pending'
  | 'reason_required'
  | 'db';

export type ApprovalOutcome =
  | { success: true; status: 'approved' | 'rejected' }
  | { success: false; error: ApprovalErrorCode };

/** Fan-out de festivo (cancelación/reactivación de entrenos). Lo inyecta el caller. */
export type HolidayNotify = (
  events: HolidayAffectedEvent[],
  kind: 'cancelled' | 'reinstated',
  reason: string | null,
) => Promise<void>;

/** Aviso al creador de la decisión de aprobación. Lo inyecta el caller. */
export type ApprovalDecision = {
  event_id: string;
  team_id: string | null;
  title: string;
  starts_at: string;
  created_by: string;
  status: 'approved' | 'rejected';
};
export type ApprovalNotify = (decision: ApprovalDecision) => Promise<void>;

export type HolidayLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;
const noopLog: HolidayLogger = () => {};

const HOLIDAY_ERRORS = new Set<string>([
  'forbidden',
  'no_session',
  'already_holiday',
  'reason_required',
  'not_found',
]);
const APPROVAL_ERRORS = new Set<string>([
  'forbidden',
  'no_session',
  'not_found',
  'not_pending',
  'reason_required',
]);

/**
 * F14F-2 — Marca un día como festivo (RPC `mark_holiday`, gate admin/director
 * DENTRO). Cancela atómicamente los entrenos activos del día; tras el éxito, avisa
 * a entrenadores/jugadores/familias (fan-out inyectado, DESPUÉS de la RPC).
 */
export async function markHolidayFromClient(
  supabase: DbClient,
  clubId: string,
  date: string,
  reason: string,
  notify: HolidayNotify,
  logError: HolidayLogger = noopLog,
): Promise<HolidayOutcome> {
  const { data, error } = await supabase.rpc('mark_holiday', {
    p_club_id: clubId,
    p_date: date,
    p_reason: reason,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && HOLIDAY_ERRORS.has(code)) {
      return { success: false, error: code as HolidayErrorCode };
    }
    return { success: false, error: 'db' };
  }

  const result = (data ?? {}) as {
    holiday_id?: string;
    reason?: string;
    cancelled?: HolidayAffectedEvent[];
  };
  const cancelled = result.cancelled ?? [];
  if (cancelled.length > 0) {
    try {
      await notify(cancelled, 'cancelled', result.reason ?? reason);
    } catch (e) {
      logError(e, 'notify_holiday_cancelled', { clubId, date });
    }
  }
  return { success: true, holidayId: result.holiday_id ?? '' };
}

/**
 * F14F-2 — Desmarca un festivo (RPC `unmark_holiday`): reactiva SOLO los entrenos
 * que canceló ese festivo y avisa de la reactivación (fan-out inyectado, DESPUÉS).
 */
export async function unmarkHolidayFromClient(
  supabase: DbClient,
  holidayId: string,
  notify: HolidayNotify,
  logError: HolidayLogger = noopLog,
): Promise<HolidayOutcome> {
  const { data, error } = await supabase.rpc('unmark_holiday', {
    p_holiday_id: holidayId,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && HOLIDAY_ERRORS.has(code)) {
      return { success: false, error: code as HolidayErrorCode };
    }
    return { success: false, error: 'db' };
  }

  const result = (data ?? {}) as { reactivated?: HolidayAffectedEvent[] };
  const reactivated = result.reactivated ?? [];
  if (reactivated.length > 0) {
    try {
      await notify(reactivated, 'reinstated', null);
    } catch (e) {
      logError(e, 'notify_holiday_reinstated', { holidayId });
    }
  }
  return { success: true, holidayId };
}

/**
 * F14F-4 — Aprueba/rechaza un training PENDIENTE en festivo (RPC
 * `decide_event_approval`, gate admin/director DENTRO). Tras el éxito, avisa al
 * creador del resultado (fan-out inyectado, DESPUÉS). El rechazo exige motivo.
 */
export async function decideEventApprovalFromClient(
  supabase: DbClient,
  eventId: string,
  approve: boolean,
  reason: string | null,
  notify: ApprovalNotify,
  logError: HolidayLogger = noopLog,
): Promise<ApprovalOutcome> {
  const { data, error } = await supabase.rpc('decide_event_approval', {
    p_event_id: eventId,
    p_approve: approve,
    p_reason: reason?.trim() ? reason.trim() : undefined,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && APPROVAL_ERRORS.has(code)) {
      return { success: false, error: code as ApprovalErrorCode };
    }
    return { success: false, error: 'db' };
  }

  const res = (data ?? {}) as {
    event_id?: string;
    team_id?: string | null;
    title?: string;
    starts_at?: string;
    created_by?: string;
    status?: 'approved' | 'rejected';
  };
  if (res.created_by && res.status && res.starts_at && res.title) {
    try {
      await notify({
        event_id: res.event_id ?? eventId,
        team_id: res.team_id ?? null,
        title: res.title,
        starts_at: res.starts_at,
        created_by: res.created_by,
        status: res.status,
      });
    } catch (e) {
      logError(e, 'notify_approval_decision', { eventId });
    }
  }
  return { success: true, status: (res.status ?? 'approved') as 'approved' | 'rejected' };
}
