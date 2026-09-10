import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  finalizeAccountDeletionFromClient,
  neutralizeAuthUser,
  type AccountDeletionLogger,
  type Database,
  type FinalizeAccountDeletionResult,
} from '@misterfc/core';

/**
 * BC-3 — Wrapper web del finalizador (core). Único punto que inyecta los dos efectos
 * con SERVICE-ROLE: el borrado del objeto de avatar en Storage y la neutralización de
 * `auth.users` con la Admin API de GoTrue.
 *
 * Nada de esto puede hacerlo SQL: `storage.protect_delete` impide el DELETE de objetos
 * por SQL, y Postgres no habla con GoTrue. Por eso la RPC devuelve la ruta del avatar y
 * el orden lo pone core (RPC → Storage → GoTrue).
 */

type Supa = SupabaseClient<Database>;

const logAccountDeletion: AccountDeletionLogger = (error, step, extra) => {
  console.error(`[account-deletion] ${step}`, { ...extra, error });
  Sentry.captureException(error, { tags: { feature: 'account-deletion', step }, extra });
};

const removeAvatarAdmin = async (avatarPath: string): Promise<void> => {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from('profile-avatars').remove([avatarPath]);
  if (error) throw new Error(error.message);
};

/**
 * Anonimiza una cuenta de punta a punta. `profileId` NO viene del cliente: lo pone el
 * caller a partir de la sesión (la propia) o de `account_deletions_due()` (el servidor).
 */
export async function finalizeAccountDeletionWeb(
  profileId: string,
): Promise<FinalizeAccountDeletionResult> {
  const admin = createSupabaseAdminClient();
  const result = await finalizeAccountDeletionFromClient(admin, profileId, {
    removeAvatar: removeAvatarAdmin,
    neutralizeAuth: (uid) => neutralizeAuthUser(admin, uid),
    logError: logAccountDeletion,
  });

  // Estado a vigilar: la cuenta quedó anonimizada pero sus credenciales siguen vivas, y
  // la solicitud ya está `completed`, así que ninguna cola la volverá a sacar.
  if (!result.ok && result.error === 'auth_neutralize_failed') {
    Sentry.captureMessage('account-deletion: anonimizada pero GoTrue sigue vivo', {
      level: 'error',
      tags: { feature: 'account-deletion', step: 'auth_neutralize_failed' },
      extra: { profileId },
    });
  }
  return result;
}

/**
 * Remata los borrados que ya no tienen nada pendiente. Se llama DESPUÉS de aprobar o
 * rechazar una supresión: si era la última que bloqueaba una cuenta, la cuenta se
 * completa en el acto en vez de esperar al cron (decisión de Jose: la cuenta se elimina
 * cuando el club aprueba). Best-effort — un fallo aquí NO revierte la supresión, y el
 * cron de los 30 días (BC-6) vuelve a pasar por encima.
 */
export async function finalizeDueAccountDeletions(): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('account_deletions_due');
  if (error) {
    logAccountDeletion(error, 'account_deletions_due', {});
    return 0;
  }
  let done = 0;
  for (const row of data ?? []) {
    const res = await finalizeAccountDeletionWeb(row.profile_id);
    if (res.ok) done += 1;
  }
  return done;
}

/** El cliente RLS del usuario, para las dos RPC que corren COMO ÉL. */
export type UserScopedClient = Supa;
