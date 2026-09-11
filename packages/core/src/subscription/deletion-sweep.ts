/**
 * SU-3 — DRENADO de la cola de borrados en RevenueCat (ADR-0022 §4c).
 *
 * `finalize_account_deletion` encola una fila por cada cuenta anonimizada; esto la
 * vacía llamando a su API REST. Vive en `packages/core` y no en `apps/web` por el mismo
 * motivo que los barridos de BC-6b: **`apps/web` no tiene runner de tests**, y esto es
 * exactamente lo que hay que poder probar sin tocar la red.
 *
 * NUNCA se abandona una fila. Si RevenueCat lleva días fallando, se sigue reintentando
 * y se avisa por `stuck`: dejar de intentarlo sería dar por perdida una supresión que
 * el RGPD nos obliga a pedir, y encima en silencio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { deleteRevenueCatCustomer, type RevenueCatConfig } from './revenuecat-api';

type AdminClient = SupabaseClient<Database>;

/** Tope por pasada: la cola crece a ritmo de bajas, así que 25 sobra de largo. */
export const SUBSCRIPTION_DELETION_SWEEP_CAP = 25;

/** A partir de aquí una fila lleva demasiado atascada y merece que alguien lo mire. */
export const STUCK_ATTEMPTS_THRESHOLD = 5;

export type DeletionSweepResult = {
  found: number;
  attempted: number;
  succeeded: number;
  failed: number;
  /** Filas que ya han fallado muchas veces. Se siguen reintentando igual. */
  stuck: number;
};

export type SubscriptionLogger = (
  error: unknown,
  code: string,
  extra?: Record<string, unknown>,
) => void;

const noopLog: SubscriptionLogger = () => {};

export async function sweepRevenueCatDeletionsFromClient(
  admin: AdminClient,
  config: RevenueCatConfig,
  deps: { logError?: SubscriptionLogger; cap?: number } = {},
): Promise<DeletionSweepResult> {
  const logError = deps.logError ?? noopLog;
  const cap = deps.cap ?? SUBSCRIPTION_DELETION_SWEEP_CAP;

  const { data, error } = await admin
    .from('revenuecat_deletion_queue')
    .select('profile_id, app_user_id, attempts')
    .is('done_at', null)
    .order('enqueued_at', { ascending: true })
    .limit(cap + 1);

  if (error) {
    // Una lectura muda aquí vaciaría la cola de la vista sin vaciarla de verdad.
    logError(error, 'revenuecat_deletion_queue_read');
    return { found: 0, attempted: 0, succeeded: 0, failed: 0, stuck: 0 };
  }

  const rows = data ?? [];
  const batch = rows.slice(0, cap);
  const result: DeletionSweepResult = {
    found: rows.length,
    attempted: batch.length,
    succeeded: 0,
    failed: 0,
    stuck: 0,
  };

  for (const row of batch) {
    if (row.attempts >= STUCK_ATTEMPTS_THRESHOLD) result.stuck += 1;

    const res = await deleteRevenueCatCustomer(row.app_user_id, config);

    if (res.ok) {
      const { error: markErr } = await admin
        .from('revenuecat_deletion_queue')
        .update({ done_at: new Date().toISOString(), last_error: null })
        .eq('profile_id', row.profile_id);
      if (markErr) {
        // El borrado SÍ se pidió; lo que falló es apuntarlo. Se reintentará, y
        // repetir un DELETE es inocuo (404 también es éxito).
        logError(markErr, 'revenuecat_deletion_mark_done', { profileId: row.profile_id });
        result.failed += 1;
      } else {
        result.succeeded += 1;
      }
      continue;
    }

    result.failed += 1;
    logError(res.raw, 'revenuecat_deletion_failed', {
      profileId: row.profile_id,
      status: res.status,
      attempts: row.attempts + 1,
    });
    const { error: bumpErr } = await admin
      .from('revenuecat_deletion_queue')
      .update({
        attempts: row.attempts + 1,
        last_error: String(res.status ?? 'network').slice(0, 500),
      })
      .eq('profile_id', row.profile_id);
    if (bumpErr) logError(bumpErr, 'revenuecat_deletion_bump', { profileId: row.profile_id });
  }

  return result;
}
