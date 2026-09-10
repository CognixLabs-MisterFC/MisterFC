/**
 * BC-6b — Las DOS COLAS del cron del borrado de cuenta.
 *
 * Viven aquí y no en `apps/web/src/lib` por la misma razón que el finalizador de BC-3:
 * `apps/web` no tiene runner de tests (todo el unitario del repo está en
 * `packages/core`). Lo que hay que poder probar es el reparto — el tope por ejecución
 * y el recuento de lo que quedó fuera —, así que la orquestación se queda aquí y la
 * web solo inyecta el efecto (`finalizeOne`, que es quien habla con GoTrue y Storage).
 *
 *  · `finalizeDueAccountDeletionsFromClient` — PLAZO. Solicitudes `pending` cuya fecha
 *    límite llegó, o que ya no tienen ninguna supresión bloqueando.
 *  · `sweepStuckAuthNeutralizationsFromClient` — BARRIDO. Cuentas ya anonimizadas cuya
 *    identidad de GoTrue sigue viva porque el paso 3 del finalizador falló. Sin esto,
 *    ese estado es PERMANENTE: la solicitud ya está `completed`, así que
 *    `account_deletions_due()` no la vuelve a sacar jamás.
 *
 * Las dos reusan el finalizador ENTERO en vez de llamar solo a su paso 3:
 * `finalize_account_deletion` devuelve NULL sin tocar nada cuando la solicitud ya está
 * `completed` (idempotente por diseño, BC-1), así que el barrido no puede divergir del
 * camino normal. Si mañana el finalizador gana un paso, las dos colas lo heredan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { AccountDeletionLogger, FinalizeAccountDeletionResult } from './finalize';

type AdminClient = SupabaseClient<Database>;

/**
 * Tope por ejecución. Cada fila son varias llamadas a GoTrue (con hasta 3 reintentos),
 * y una función serverless tiene un techo de tiempo. Lo que sobra se recoge en la
 * siguiente pasada; el caller ve el resto en `found - attempted` y puede alertar.
 */
export const ACCOUNT_DELETION_SWEEP_CAP = 25;

/** Un paso del finalizador completo, inyectado (la web pone service-role + GoTrue). */
export type FinalizeOne = (profileId: string) => Promise<FinalizeAccountDeletionResult>;

export type SweepResult = {
  /** Filas que la cola devolvió, ANTES de aplicar el tope. */
  found: number;
  /** Intentadas en esta ejecución (`min(found, cap)`). */
  attempted: number;
  /** Terminadas de verdad: no volverán a salir en la cola. */
  succeeded: number;
  /** Fallaron. Cada una ha dejado su rastro por `logError`. */
  failed: number;
};

const empty = (): SweepResult => ({ found: 0, attempted: 0, succeeded: 0, failed: 0 });

async function runSweep(
  rows: { profile_id: string }[],
  finalizeOne: FinalizeOne,
  cap: number,
): Promise<SweepResult> {
  const batch = rows.slice(0, cap);
  const result: SweepResult = {
    found: rows.length,
    attempted: batch.length,
    succeeded: 0,
    failed: 0,
  };
  for (const row of batch) {
    const res = await finalizeOne(row.profile_id);
    if (res.ok) result.succeeded += 1;
    else result.failed += 1;
  }
  return result;
}

export type SweepDeps = {
  finalizeOne: FinalizeOne;
  logError?: AccountDeletionLogger;
  /** Solo para tests; en producción se usa `ACCOUNT_DELETION_SWEEP_CAP`. */
  cap?: number;
};

/**
 * PLAZO — remata los borrados que ya no tienen nada pendiente. Lo llama el cron y
 * también `decideErasureWeb` justo después de que el club apruebe o rechace: si esa
 * era la última supresión que bloqueaba una cuenta, se completa en el acto en vez de
 * esperar (decisión de Jose). Best-effort: un fallo aquí NO revierte la supresión, y
 * el cron vuelve a pasar por encima.
 */
export async function finalizeDueAccountDeletionsFromClient(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<SweepResult> {
  const { data, error } = await admin.rpc('account_deletions_due');
  if (error) {
    deps.logError?.(error, 'account_deletions_due', {});
    return empty();
  }
  return runSweep(data ?? [], deps.finalizeOne, deps.cap ?? ACCOUNT_DELETION_SWEEP_CAP);
}

/**
 * BARRIDO — reintenta las neutralizaciones de GoTrue que se quedaron a medias.
 *
 * `account_deletions_auth_pending()` (BC-6a) mira el estado REAL de `auth.users` —
 * igualdad exacta del email + ban vigente — en vez de un flag nuestro, así que también
 * recoge las que fallaron ANTES de que este barrido existiera.
 */
export async function sweepStuckAuthNeutralizationsFromClient(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<SweepResult> {
  const { data, error } = await admin.rpc('account_deletions_auth_pending');
  if (error) {
    deps.logError?.(error, 'account_deletions_auth_pending', {});
    return empty();
  }
  return runSweep(data ?? [], deps.finalizeOne, deps.cap ?? ACCOUNT_DELETION_SWEEP_CAP);
}
