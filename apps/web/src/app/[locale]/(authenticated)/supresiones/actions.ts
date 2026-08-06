'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { decideErasureWeb } from '@/lib/erasures';

export type DecideErasureState = {
  error?: 'forbidden' | 'already_decided' | 'not_found' | 'generic';
  success?: boolean;
};

/**
 * F14-7 — admin_club/director aprueba o rechaza una solicitud de supresión.
 *
 * O2-11c-2 — la lógica (RPC `decide_player_erasure` como el usuario + borrado del
 * objeto de Storage con service-role DESPUÉS, best-effort) se extrajo a
 * `@/lib/erasures` (compartida con los route handlers nativos). Esta Server Action
 * queda como wrapper cookie, comportamiento idéntico. El gate de la web sigue en la
 * page (`role !== 'admin_club' → redirect`).
 */
export async function decideErasure(
  requestId: string,
  approve: boolean,
  reason: string | null,
): Promise<DecideErasureState> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const res = await decideErasureWeb(supabase, requestId, approve, reason);
  revalidatePath('/[locale]/(authenticated)/supresiones', 'page');
  return res.success ? { success: true } : { error: res.error };
}
