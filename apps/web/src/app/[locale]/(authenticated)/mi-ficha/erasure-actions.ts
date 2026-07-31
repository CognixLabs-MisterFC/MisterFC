'use server';

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  requestPlayerErasureFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ErasureRequestState = { error?: 'forbidden' | 'generic'; success?: boolean };

/**
 * F14-7 — el TUTOR solicita la supresión (derecho al olvido) de su hijo. Delega en
 * la RPC `request_player_erasure` (SECURITY DEFINER): valida que es tutor y crea
 * una solicitud pendiente (idempotente). La decisión la toma admin_club/director.
 *
 * O2-5 C2 — la invocación + mapeo de error viven en core
 * (`requestPlayerErasureFromClient`); aquí solo se revalida.
 */
export async function requestPlayerErasure(
  playerId: string,
  reason: string | null,
): Promise<ErasureRequestState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await requestPlayerErasureFromClient(supabase, playerId, reason);

  if ('ok' in res) {
    revalidatePath('/[locale]/(authenticated)/mi-ficha', 'page');
    return { success: true };
  }
  return { error: res.error };
}
