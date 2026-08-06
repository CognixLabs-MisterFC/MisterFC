/**
 * O2-11c-2 — Orquestador de la DECISIÓN de supresión RGPD (FromClient), extraído del
 * inline de `apps/web/.../supresiones/actions.ts` (F14-7). Es la acción MÁS
 * IRREVERSIBLE del sistema (borrado de datos de un menor).
 *
 * La RPC `decide_player_erasure` se llama COMO EL USUARIO y hace TODO en una
 * transacción (aprobar: borra médica, pone photo_url a NULL, bloquea apellido, marca
 * erased_at; devuelve la RUTA de la foto en Storage). El objeto de Storage NO se
 * puede borrar por SQL (`storage.protect_delete`) → se elimina con service-role,
 * DESPUÉS de la RPC, vía el callback `removePhoto` inyectado (el caller aporta el
 * admin client — core no depende de él). El borrado del objeto es best-effort: si
 * falla, la RPC YA aplicó la supresión → se logea, NO se revierte (el objeto queda
 * huérfano, oculto por la RLS de erased_at).
 *
 * GATE: la RPC gatea `user_is_admin_or_director`. El gate admin_club-ONLY de la app
 * (más estricto que la RPC) lo aplica el caller (route handler) ANTES de llamar aquí.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

export type ErasureErrorCode = 'forbidden' | 'already_decided' | 'not_found' | 'generic';
export type ErasureOutcome = { success: true } | { success: false; error: ErasureErrorCode };

/** Borrado del objeto de foto (service-role). Lo inyecta el caller (admin client). */
export type RemovePhoto = (photoPath: string) => Promise<void>;
export type ErasureLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;
const noopLog: ErasureLogger = () => {};

export async function decidePlayerErasureFromClient(
  supabase: DbClient,
  requestId: string,
  approve: boolean,
  reason: string | null,
  removePhoto: RemovePhoto,
  logError: ErasureLogger = noopLog,
): Promise<ErasureOutcome> {
  const { data: photoPath, error } = await supabase.rpc('decide_player_erasure', {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: (reason && reason.trim().length > 0
      ? reason.trim().slice(0, 500)
      : null) as unknown as string,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { success: false, error: 'forbidden' };
    if (msg.includes('already_decided')) return { success: false, error: 'already_decided' };
    if (msg.includes('not_found')) return { success: false, error: 'not_found' };
    return { success: false, error: 'generic' };
  }

  // Borrado del objeto de foto (service-role) DESPUÉS de la RPC. SOLO al aprobar y si
  // la RPC devolvió ruta. best-effort: un fallo NO revierte la supresión (ya aplicada).
  if (approve && typeof photoPath === 'string' && photoPath.length > 0) {
    try {
      await removePhoto(photoPath);
    } catch (e) {
      logError(e, 'erasure_remove_photo', { requestId, photoPath });
    }
  }

  return { success: true };
}
