'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ErasureRequestState = { error?: 'forbidden' | 'generic'; success?: boolean };

/**
 * F14-7 — el TUTOR solicita la supresión (derecho al olvido) de su hijo. Delega en
 * la RPC `request_player_erasure` (SECURITY DEFINER): valida que es tutor y crea
 * una solicitud pendiente (idempotente). La decisión la toma admin_club/director.
 */
export async function requestPlayerErasure(
  playerId: string,
  reason: string | null,
): Promise<ErasureRequestState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('request_player_erasure', {
    p_player_id: playerId,
    p_reason: (reason && reason.trim().length > 0 ? reason.trim().slice(0, 500) : null) as unknown as string,
  });

  if (error) {
    return { error: (error.message ?? '').includes('forbidden') ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/mi-ficha', 'page');
  return { success: true };
}
