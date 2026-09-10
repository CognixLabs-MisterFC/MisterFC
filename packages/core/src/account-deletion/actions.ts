/**
 * BC-2 — ESCRITURAS del borrado de cuenta. Dos RPC, las dos SECURITY DEFINER y las dos
 * con `auth.uid()` cableado: un usuario solo puede pedir y cancelar SU propio borrado.
 *
 * Lo que NO está aquí, a propósito:
 *  · `finalize_account_deletion` y `account_deletions_due` están cerradas a
 *    `authenticated` (solo `service_role`). Su orquestación —RPC, borrado del avatar en
 *    Storage y neutralización de `auth.users` por Admin API, en ese orden— es BC-3.
 *  · El write-guard sin conexión es del caller (la nativa lo aplica en la pantalla).
 *
 * `request_account_deletion` NO completa el borrado: corta el acceso, genera las
 * solicitudes de supresión y devuelve cuántas quedan pendientes. Si `blockingPlayers`
 * es 0 el caller puede rematar el borrado en el acto (camino rápido de BC-3/BC-5, el
 * que se graba para Apple); si es > 0, la cuenta queda en curso con fecha límite.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

/**
 * Códigos que levantan las RPC (ver migración `20261059000000_bc1_account_deletion_engine`):
 *  · `no_session`       — sin sesión.
 *  · `not_pending`      — cancelar sin borrado en curso (o ya completado/cancelado).
 *  · `admin_slot_taken` — al cancelar, el club ya tiene otro `admin_club` activo, así que
 *                         no se puede reactivar la membership. Hay que hablar con el club.
 *  · `generic`          — cualquier otra cosa; `raw` lleva el error crudo para logarlo.
 */
export type AccountDeletionErrorCode =
  | 'no_session'
  | 'not_pending'
  | 'admin_slot_taken'
  | 'generic';

export type AccountDeletionRequestResult =
  | { ok: true; requestId: string; blockingPlayers: number }
  | { ok: false; error: AccountDeletionErrorCode; raw: unknown };

export type AccountDeletionCancelResult =
  | { ok: true }
  | { ok: false; error: AccountDeletionErrorCode; raw: unknown };

/** Mapea el mensaje de la RPC a un código. Orden: del más específico al genérico. */
function mapError(error: { message?: string } | null): AccountDeletionErrorCode {
  const msg = (error?.message ?? '').toLowerCase();
  if (msg.includes('admin_slot_taken')) return 'admin_slot_taken';
  if (msg.includes('not_pending')) return 'not_pending';
  if (msg.includes('no_session')) return 'no_session';
  return 'generic';
}

/**
 * `request_account_deletion(p_reason)` — UNA pulsación. Idempotente: si ya hay un
 * borrado en curso devuelve el mismo `requestId` sin duplicar nada.
 *
 * El motivo se recorta a 500 caracteres (el CHECK de la tabla) y, si queda vacío, se
 * pasa `undefined` para que PostgREST omita la clave y la RPC aplique su DEFAULT NULL
 * — mismo truco que `requestPlayerErasureFromClient`, y así el tipo generado
 * (`p_reason?: string`) no necesita override de nullability.
 */
export async function requestAccountDeletionFromClient(
  supabase: DbClient,
  reason: string | null,
): Promise<AccountDeletionRequestResult> {
  const trimmed = reason && reason.trim().length > 0 ? reason.trim().slice(0, 500) : undefined;
  const { data, error } = await supabase.rpc('request_account_deletion', {
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: mapError(error), raw: error };

  const row = data?.[0];
  if (!row) {
    // La RPC siempre devuelve una fila. Sin fila no sabemos si el borrado se registró:
    // no se puede decir que salió bien.
    return { ok: false, error: 'generic', raw: new Error('request_account_deletion sin fila') };
  }
  return { ok: true, requestId: row.request_id, blockingPlayers: row.blocking_players };
}

/**
 * `cancel_account_deletion()` — arrepentimiento, admitido en cualquier momento hasta que
 * el job remate el borrado (decisión 3 de Jose: sin ventana más corta). Reactiva SOLO
 * las memberships que la solicitud puso de baja y retira SOLO las supresiones que
 * nacieron de ella; una que el tutor pidiera antes por su cuenta sobrevive.
 */
export async function cancelAccountDeletionFromClient(
  supabase: DbClient,
): Promise<AccountDeletionCancelResult> {
  const { error } = await supabase.rpc('cancel_account_deletion');
  if (error) return { ok: false, error: mapError(error), raw: error };
  return { ok: true };
}
