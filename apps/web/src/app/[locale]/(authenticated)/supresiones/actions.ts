'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type DecideErasureState = {
  error?: 'forbidden' | 'already_decided' | 'not_found' | 'generic';
  success?: boolean;
};

/**
 * F14-7 — admin_club/director aprueba o rechaza una solicitud de supresión. La RPC
 * `decide_player_erasure` hace TODO en una transacción (oculta: borra médica, pone
 * photo_url a NULL, bloquea apellido) y devuelve la RUTA de la foto para borrar el
 * objeto. El objeto de storage NO se puede borrar por SQL (storage.protect_delete),
 * así que se elimina aquí por Storage API DESPUÉS de que la RPC confirme. Si el
 * borrado del objeto falla, NO se revierte la supresión (ya está aplicada en BD):
 * se registra para reintento manual (el objeto queda huérfano, no accesible porque
 * la RLS lo oculta por erased_at, pero conviene limpiarlo).
 */
export async function decideErasure(
  requestId: string,
  approve: boolean,
  reason: string | null,
): Promise<DecideErasureState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: photoPath, error } = await supabase.rpc('decide_player_erasure', {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: (reason && reason.trim().length > 0 ? reason.trim().slice(0, 500) : null) as unknown as string,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('already_decided')) return { error: 'already_decided' };
    if (msg.includes('not_found')) return { error: 'not_found' };
    return { error: 'generic' };
  }

  // Borrado del objeto de foto (Storage API). Best-effort: no revierte la supresión.
  if (approve && typeof photoPath === 'string' && photoPath.length > 0) {
    try {
      const admin = createSupabaseAdminClient();
      const { error: rmErr } = await admin.storage.from('player-photos').remove([photoPath]);
      if (rmErr) {
        console.error('[erasure] fallo al borrar el objeto de foto', {
          requestId,
          photoPath,
          error: rmErr.message,
        });
      }
    } catch (e) {
      console.error('[erasure] excepción al borrar el objeto de foto', { requestId, error: e });
    }
  }

  revalidatePath('/[locale]/(authenticated)/supresiones', 'page');
  return { success: true };
}
