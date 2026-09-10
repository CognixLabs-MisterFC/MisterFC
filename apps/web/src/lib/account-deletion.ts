import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  finalizeAccountDeletionFromClient,
  finalizeDueAccountDeletionsFromClient,
  neutralizeAuthUser,
  sweepStuckAuthNeutralizationsFromClient,
  type AccountDeletionLogger,
  type Database,
  type FinalizeAccountDeletionResult,
  type SweepResult,
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
 * BC-6b — las dos colas del cron. La orquestación (tope, recuento) vive en core, que es
 * donde hay tests; aquí solo se inyecta el finalizador con service-role.
 */
const sweepDeps = { finalizeOne: finalizeAccountDeletionWeb, logError: logAccountDeletion };

/**
 * PLAZO. Se llama desde el cron (BC-6b) y desde `decideErasureWeb` justo después de
 * aprobar o rechazar una supresión: si era la última que bloqueaba una cuenta, la
 * cuenta se completa en el acto en vez de esperar al cron (decisión de Jose).
 * Best-effort — un fallo aquí NO revierte la supresión.
 */
export async function finalizeDueAccountDeletions(): Promise<SweepResult> {
  return finalizeDueAccountDeletionsFromClient(createSupabaseAdminClient(), sweepDeps);
}

/**
 * BARRIDO de las neutralizaciones de GoTrue que se quedaron a medias. Sin esto, una
 * cuenta anonimizada cuyo `updateUserById` falló se queda con las credenciales VIVAS
 * para siempre: la solicitud ya está `completed`, así que `account_deletions_due()` no
 * la vuelve a sacar. Cada fallo que persista deja su alerta desde
 * `finalizeAccountDeletionWeb`.
 */
export async function sweepStuckAuthNeutralizations(): Promise<SweepResult> {
  return sweepStuckAuthNeutralizationsFromClient(createSupabaseAdminClient(), sweepDeps);
}

/** El cliente RLS del usuario, para las dos RPC que corren COMO ÉL. */
export type UserScopedClient = Supa;
