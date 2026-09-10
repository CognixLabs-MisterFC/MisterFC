'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  cancelAccountDeletionFromClient,
  createSupabaseServerClient,
  requestAccountDeletionFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { finalizeAccountDeletionWeb } from '@/lib/account-deletion';

/**
 * BC-4 — Server Actions del borrado de cuenta en web. Wrapper cookie de lo que ya
 * existe: las RPC corren COMO EL USUARIO (`auth.uid()` cableado en el SQL) y el trozo
 * con service-role vive en `@/lib/account-deletion`, compartido con los route handlers
 * de la nativa. Mismo reparto que `decideErasure` con `@/lib/erasures`.
 */

export type RequestAccountDeletionState =
  | { ok: true; completed: boolean; blockingPlayers: number }
  | { ok: false; error: 'no_session' | 'generic' };

/**
 * Pide el borrado. Si no quedaba nadie bloqueando, se remata aquí mismo y se cierra la
 * sesión: es el camino rápido y el que se graba para Apple. Si quedan bloqueantes, el
 * acceso YA está cortado y el usuario cae en la pantalla de "borrado en curso".
 */
export async function requestAccountDeletion(
  reason: string | null,
): Promise<RequestAccountDeletionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const res = await requestAccountDeletionFromClient(supabase, reason);
  if (!res.ok) {
    return { ok: false, error: res.error === 'no_session' ? 'no_session' : 'generic' };
  }

  let completed = false;
  if (res.blockingPlayers === 0 && userId) {
    const fin = await finalizeAccountDeletionWeb(userId);
    // `auth_neutralize_failed` cuenta como completado A EFECTOS DE LO QUE VE EL USUARIO:
    // la anonimización SÍ se aplicó (nombre, foto, teléfono, vínculos… ya no están) y lo
    // único que quedó a medias fue neutralizar las credenciales en GoTrue, que BC-6
    // repescará. Si aquí dijéramos `false`, el usuario caería en el dead-end y, como su
    // solicitud ya está `completed`, no habría borrado en curso que enseñarle: leería el
    // banner de baja, o sea "te ha dado de baja el club", que es FALSO. Solo un
    // `rpc_failed` (no se tocó nada) merece la pantalla de borrado en curso.
    completed = fin.ok || fin.error === 'auth_neutralize_failed';
  }

  // El club activo deja de existir en cualquier caso: sus memberships están de baja.
  (await cookies()).delete(ACTIVE_CLUB_COOKIE_NAME);

  // La sesión SOLO se cierra si la cuenta se completó. Si quedan bloqueantes hay que
  // dejarle entrar: es la única forma de que vea el estado, la fecha límite y el botón
  // de cancelar. No está baneado (eso lo hace `finalize`), así que podrá volver a
  // entrar más adelante y caerá en la misma pantalla.
  if (completed) {
    await supabase.auth.signOut();
  }

  return { ok: true, completed, blockingPlayers: res.blockingPlayers };
}

export type CancelAccountDeletionState =
  | { ok: true }
  | { ok: false; error: 'not_pending' | 'admin_slot_taken' | 'generic' };

/** Retira el borrado. Admitido hasta que el job lo remate (decisión de Jose). */
export async function cancelAccountDeletion(): Promise<CancelAccountDeletionState> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const res = await cancelAccountDeletionFromClient(supabase);
  if (!res.ok) {
    if (res.error === 'not_pending') return { ok: false, error: 'not_pending' };
    if (res.error === 'admin_slot_taken') return { ok: false, error: 'admin_slot_taken' };
    return { ok: false, error: 'generic' };
  }
  revalidatePath('/[locale]/onboarding', 'page');
  return { ok: true };
}
