/**
 * O2-9b — COLA DE ESCRITURA OFFLINE del DIRECTO (la ÚNICA de toda la app).
 *
 * ADR-0020 Decisión 5 dice "offline = solo lectura"; ESTA es la excepción ACOTADA
 * y única: los EVENTOS de un directo (gol/tarjeta/cambio/gol rival) se pueden
 * registrar SIN red y se suben al reconectar. NO se generaliza a ninguna otra
 * escritura (el reloj/estado de 9a va ONLINE, sin cola). Todo aquí es PURO o el
 * primitivo de subida; la persistencia (secure-store) y la orquestación viven en
 * `apps/native/src/directo/*`.
 *
 * Invariantes que hacen la cola SEGURA (un evento = un gol de un partido real):
 *  1. IDEMPOTENCIA POR PK: cada evento lleva un `id` (UUID v4) generado en el
 *     CLIENTE. La subida es `upsert(row, {onConflict:'id', ignoreDuplicates:true})`
 *     — subir dos veces el mismo id es un no-op (§10, mismo patrón que la web).
 *  2. APPEND-INDEPENDENCIA: la fila se construye COMPLETA en el momento del toque
 *     (`buildMatchEventRow`), con su `clock_seconds` ABSOLUTO derivado del reloj
 *     local (mismo motor puro que pinta el cronómetro). Al drenar más tarde el
 *     reloj ya habrá avanzado, pero el evento conserva SU instante: no depende del
 *     orden ni del estado de los demás. La subida es un upsert "tonto".
 *  3. APPEND-ONLY offline: offline solo se AÑADEN filas. Borrar/editar exige red
 *     (write-guard). El marcador se DERIVA (`computeScore`) de los eventos.
 *  4. SIN PÉRDIDA SILENCIOSA: una fila no se quita de la cola hasta CONFIRMAR que
 *     el servidor la tiene. Un error de Postgres al subir (RLS/CHECK) = PERMANENTE
 *     → se marca `failed` (se avisa, no se pierde). Un error de red = TRANSITORIO
 *     → sigue `pending` y se reintenta (con tope).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { playerEventClockFields } from './event';
import type { ClockPeriod } from './clock';

type DbClient = SupabaseClient<Database>;

// ─────────────────────────────────────────────────────────────────────────────
// Fila y entrada del registro rápido
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subconjunto de columnas de `match_events` que 9b escribe (modelo canónico,
 * O2-1c — NO generado por db:types). Estructuralmente asignable al `Insert` de la
 * tabla: incluye los NOT NULL (id/event_id/club_id/created_by/side/type/
 * clock_seconds) y el resto según el tipo de evento. `created_by`/`club_id` los
 * FUERZA el trigger de 7.1 con auth.uid()/el club del evento; se rellenan aquí
 * para el NOT NULL del Insert y para que la fila encolada esté completa.
 */
export interface QueuedMatchEventRow {
  id: string;
  event_id: string;
  club_id: string;
  created_by: string;
  side: 'own' | 'rival';
  type: string;
  player_id: string | null;
  related_player_id: string | null;
  rival_dorsal: number | null;
  period: string;
  clock_seconds: number;
  display_minute: number;
  metadata: Record<string, never>;
}

/**
 * Registro rápido: lo MÍNIMO que el entrenador elige (tipo + actor). El resto
 * (bando, reloj, minuto, periodo) lo deriva `buildMatchEventRow`. Cubre los
 * eventos "está pasando AHORA": gol propio, tarjeta, cambio y gol rival.
 */
export type QuickEntryInput =
  | { kind: 'player_goal'; playerId: string }
  | { kind: 'card'; card: 'yellow_card' | 'red_card'; playerId: string }
  | { kind: 'substitution'; playerOutId: string; playerInId: string }
  | { kind: 'rival_goal'; dorsal: number };

/** Contexto para construir la fila COMPLETA en el instante del toque. */
export interface BuildEventContext {
  /** UUID v4 generado en el cliente = PK (idempotencia). */
  id: string;
  eventId: string;
  clubId: string;
  createdBy: string;
  /** Periodos del reloj (los mismos que pintan el cronómetro, de match_periods). */
  periods: readonly ClockPeriod[];
  /** Instante del toque (Date.now() en la app). El reloj se deriva de aquí. */
  nowMs: number;
}

/**
 * Construye la fila `match_events` COMPLETA de un registro rápido, con su
 * `clock_seconds`/`period`/`display_minute` derivados del reloj EN EL MOMENTO del
 * toque (mismo `playerEventClockFields` que usa la web en el servidor). Pura: dado
 * el mismo `ctx` (incl. `id` y `nowMs`) produce siempre la misma fila → encolable,
 * reproducible y testeable. Aquí es donde se "congela" el instante del evento.
 */
export function buildMatchEventRow(
  input: QuickEntryInput,
  ctx: BuildEventContext,
): QueuedMatchEventRow {
  const { clockSeconds, period, displayMinute } = playerEventClockFields(
    ctx.periods,
    ctx.nowMs,
  );
  const base = {
    id: ctx.id,
    event_id: ctx.eventId,
    club_id: ctx.clubId,
    created_by: ctx.createdBy,
    player_id: null as string | null,
    related_player_id: null as string | null,
    rival_dorsal: null as number | null,
    period,
    clock_seconds: clockSeconds,
    display_minute: displayMinute,
    metadata: {} as Record<string, never>,
  };

  switch (input.kind) {
    case 'player_goal':
      return { ...base, side: 'own', type: 'goal', player_id: input.playerId };
    case 'card':
      return { ...base, side: 'own', type: input.card, player_id: input.playerId };
    case 'substitution':
      return {
        ...base,
        side: 'own',
        type: 'substitution',
        player_id: input.playerOutId,
        related_player_id: input.playerInId,
      };
    case 'rival_goal':
      return { ...base, side: 'rival', type: 'goal', rival_dorsal: input.dorsal };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La cola (estructura + transiciones PURAS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado de una fila en la cola:
 *  - `pending`  → aún no confirmada en el servidor; candidata a drenar.
 *  - `uploaded` → el upsert devolvió ok, pero AÚN no se ha visto en el servidor.
 *                 Se mantiene (no se borra) hasta confirmar el ida y vuelta →
 *                 evita parpadeo y cubre el caso "creí que subió pero no está".
 *  - `failed`   → el servidor la RECHAZÓ (RLS/CHECK, error permanente). NO se
 *                 reintenta sola; se AVISA y se puede reintentar a mano. No se
 *                 pierde.
 */
export type QueuedEventStatus = 'pending' | 'uploaded' | 'failed';

export type QueuedEvent = {
  row: QueuedMatchEventRow;
  status: QueuedEventStatus;
  /** Intentos de subida efectuados (para el tope de reintentos transitorios). */
  attempts: number;
  /** Motivo del último fallo permanente (para el aviso). */
  failure?: EventQueueError;
};

export type EventQueue = QueuedEvent[];

export const EMPTY_QUEUE: EventQueue = [];

/** Tope de reintentos de un error TRANSITORIO antes de marcar `failed`. */
export const MAX_DRAIN_ATTEMPTS = 5;

/**
 * Añade una fila a la cola como `pending`. IDEMPOTENTE: si ya hay una entrada con
 * ese `id` (doble toque, re-enqueue de un persistido) NO se duplica — se devuelve
 * la cola tal cual. El `id` cliente es la clave, igual que en el servidor.
 */
export function enqueueEvent(queue: EventQueue, row: QueuedMatchEventRow): EventQueue {
  if (queue.some((e) => e.row.id === row.id)) return queue;
  return [...queue, { row, status: 'pending', attempts: 0 }];
}

/** Filas `pending`, EN ORDEN de llegada — las que hay que drenar. */
export function pendingForDrain(queue: EventQueue): QueuedEvent[] {
  return queue.filter((e) => e.status === 'pending');
}

export function countPending(queue: EventQueue): number {
  return queue.filter((e) => e.status === 'pending').length;
}

export function countFailed(queue: EventQueue): number {
  return queue.filter((e) => e.status === 'failed').length;
}

/** ¿Queda algo por subir (pending) o algo subido sin confirmar? */
export function hasUnconfirmed(queue: EventQueue): boolean {
  return queue.some((e) => e.status === 'pending' || e.status === 'uploaded');
}

/**
 * Resultado de intentar subir UNA fila, plegado sobre la cola de forma PURA:
 *  - `ok`         → `uploaded` (NO se borra aún; se poda al confirmar en servidor).
 *  - `permanent`  → `failed` con el motivo (RLS/CHECK; no se reintenta solo).
 *  - `transient`  → sigue `pending`, `attempts+1`; al superar el tope → `failed`.
 */
export type DrainResult =
  | { kind: 'ok' }
  | { kind: 'permanent'; error: EventQueueError }
  | { kind: 'transient' };

export function applyDrainResult(
  queue: EventQueue,
  id: string,
  result: DrainResult,
): EventQueue {
  return queue.map((e) => {
    if (e.row.id !== id) return e;
    const attempts = e.attempts + 1;
    switch (result.kind) {
      case 'ok':
        return { ...e, status: 'uploaded', attempts };
      case 'permanent':
        return { ...e, status: 'failed', attempts, failure: result.error };
      case 'transient':
        return attempts >= MAX_DRAIN_ATTEMPTS
          ? { ...e, status: 'failed', attempts, failure: 'generic' }
          : { ...e, status: 'pending', attempts };
    }
  });
}

/**
 * Poda las filas `uploaded` cuyo `id` YA aparece en el servidor (ida y vuelta
 * confirmado). Solo entonces se quitan de la cola — nunca antes de saber que están
 * persistidas. Las `pending`/`failed` no se tocan. Si un `pending` aparece en el
 * servidor (lo subió otro dispositivo con el mismo id — imposible, id único
 * cliente; o la web reimportó), también se poda: ya está.
 */
export function pruneConfirmed(queue: EventQueue, serverIds: ReadonlySet<string>): EventQueue {
  return queue.filter((e) => {
    if (e.status === 'failed') return true;
    return !serverIds.has(e.row.id);
  });
}

/** Reintentar a mano los `failed`: vuelven a `pending` (attempts a 0). */
export function resetFailedToPending(queue: EventQueue): EventQueue {
  return queue.map((e) =>
    e.status === 'failed'
      ? { ...e, status: 'pending', attempts: 0, failure: undefined }
      : e,
  );
}

/**
 * Filas que deben SUPERPONERSE al timeline/marcador: las `pending` y `uploaded`
 * (aún no visibles o recién visibles en el servidor), NUNCA las `failed` (el
 * servidor las rechazó → no cuentan en el marcador; se muestran aparte como aviso).
 */
export function overlayRows(queue: EventQueue): QueuedMatchEventRow[] {
  return queue.filter((e) => e.status !== 'failed').map((e) => e.row);
}

/** Filas RECHAZADAS por el servidor (para el aviso "no se pudo guardar"). */
export function failedEntries(queue: EventQueue): QueuedEvent[] {
  return queue.filter((e) => e.status === 'failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivo de SUBIDA (el ÚNICO toque a BD de la cola)
// ─────────────────────────────────────────────────────────────────────────────

export type EventQueueError = 'forbidden' | 'player_not_in_team' | 'invalid' | 'generic';

/** Traduce el error de Postgres al subir (mismo criterio que la web `mapEventErr`). */
function mapUploadErr(message: string | undefined, code: string | undefined): EventQueueError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('player_not_in_team_at_event')) return 'player_not_in_team';
  if (message.includes('event_not_match')) return 'invalid';
  if (message.includes('event_without_team')) return 'invalid';
  return 'generic';
}

export type UploadOutcome =
  | { ok: true }
  | { ok: false; permanent: boolean; error: EventQueueError };

/**
 * Sube UNA fila con `upsert(onConflict:'id', ignoreDuplicates:true)` — subir dos
 * veces el mismo id NO duplica (idempotencia por PK). Es el primitivo de drenado:
 * NO deriva reloj ni consulta nada (la fila ya viene completa de
 * `buildMatchEventRow`).
 *
 * Clasificación del fallo, clave para la cola:
 *  - Postgres DEVUELVE un error (RLS 42501 / CHECK / FK) ⇒ PERMANENTE: la fila es
 *    inválida o el gate la rechaza; reintentar no la arreglará → `failed`.
 *  - La llamada LANZA (red caída, fetch abortado) ⇒ TRANSITORIO: no llegó a
 *    ejecutarse → seguir `pending` y reintentar al reconectar.
 */
export async function upsertMatchEventFromClient(
  supabase: DbClient,
  row: QueuedMatchEventRow,
): Promise<UploadOutcome> {
  try {
    const { error } = await supabase
      .from('match_events')
      .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      return { ok: false, permanent: true, error: mapUploadErr(error.message, error.code) };
    }
    return { ok: true };
  } catch {
    // Excepción lanzada (red) → no se ejecutó en el servidor → transitorio.
    return { ok: false, permanent: false, error: 'generic' };
  }
}
