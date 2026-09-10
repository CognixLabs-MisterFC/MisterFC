/**
 * BC-3 — FINALIZACIÓN del borrado de cuenta. Solo servidor: la RPC está cerrada a
 * `authenticated` y todo lo de aquí exige service-role.
 *
 * ORDEN INVIOLABLE (lo irreversible, lo ÚLTIMO — mismo espíritu que F14-7):
 *   1. RPC `finalize_account_deletion` → anonimiza `profiles`, limpia contacto e
 *      invitaciones, borra vínculos y canales, libera `clubs.owner_profile_id`, y
 *      DEVUELVE la ruta del avatar. Si falla, no se ha destruido nada.
 *   2. Borrado del objeto de avatar en Storage (best-effort: si falla, la
 *      anonimización YA está aplicada; se logea y el objeto queda huérfano).
 *   3. Neutralización de `auth.users` con la Admin API de GoTrue. La última, porque
 *      es la que deja la cuenta sin vuelta atrás.
 *
 * TODO lo que hay aquí sobre GoTrue está MEDIDO contra el entorno real (sonda de
 * BC-3, 2026-09-10, proyecto de producción, usuario desechable creado y borrado):
 *
 *  · `updateUserById` con `email_confirm: true` NO abre el flujo de cambio de email:
 *    medido `email_change` vacío, `email_change_sent_at` NULL y
 *    `email_change_confirm_status = 0`. **No se envía correo a la dirección antigua.**
 *  · `auth.identities.identity_data.email` (y la columna `identities.email`) SÍ se
 *    actualizan solas a la dirección nueva. No hace falta limpiarlas aparte.
 *  · GoTrue acepta un dominio `.invalid` (RFC 2606, no enruta a ninguna parte).
 *  · ⚠️ `user_metadata: {}` NO limpia nada: GoTrue **fusiona**, no reemplaza. En la
 *    sonda sobrevivió `full_name`. La única forma de BORRAR una clave es enviarla a
 *    `null`, y por eso las claves se derivan EN CALIENTE de la metadata real en vez
 *    de una lista fija: en producción hay `full_name`, `date_of_birth` y `email`
 *    (censo del 2026-09-10), y una lista hardcodeada se queda corta en cuanto un
 *    flujo nuevo añada una clave.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type AdminClient = SupabaseClient<Database>;

/** Claves de `user_metadata` que gestiona GoTrue y que no son PII: se conservan. */
const GOTRUE_OWNED_METADATA_KEYS = new Set(['email_verified', 'phone_verified', 'sub']);

/** Ban efectivamente permanente: 100 años (medido → `banned_until` = 2126). */
const BAN_DURATION = '876000h';

/** Dominio reservado por RFC 2606: no resuelve, así que nunca puede recibir correo. */
export function deletedEmailFor(profileId: string): string {
  return `deleted-${profileId}@deleted.invalid`;
}

function randomPassword(): string {
  return `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`.replace(/-/g, '');
}

/**
 * Deja la identidad de GoTrue inservible: sin email recuperable, sin contraseña
 * conocida, sin metadata personal y baneada. NO borra la fila (no se puede: ver
 * ADR-0021). Idempotente — repetirla sobre una cuenta ya neutralizada es inocuo.
 */
export async function neutralizeAuthUser(admin: AdminClient, profileId: string): Promise<void> {
  const { data: current, error: readErr } = await admin.auth.admin.getUserById(profileId);
  if (readErr) throw new Error(`getUserById: ${readErr.message}`);

  // GoTrue FUSIONA la metadata: para borrar una clave hay que mandarla a null.
  const metadata = current?.user?.user_metadata ?? {};
  const nulled: Record<string, null> = {};
  for (const key of Object.keys(metadata)) {
    if (!GOTRUE_OWNED_METADATA_KEYS.has(key)) nulled[key] = null;
  }

  const { error } = await admin.auth.admin.updateUserById(profileId, {
    email: deletedEmailFor(profileId),
    email_confirm: true,
    password: randomPassword(),
    user_metadata: nulled,
    ban_duration: BAN_DURATION,
  });
  if (error) throw new Error(`updateUserById: ${error.message}`);
}

export type AvatarRemover = (avatarPath: string) => Promise<void>;
export type AuthNeutralizer = (profileId: string) => Promise<void>;
export type AccountDeletionLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;
const noopLog: AccountDeletionLogger = () => {};

export type FinalizeAccountDeletionResult =
  /** Anonimizada de verdad. `alreadyResolved` = no había nada pendiente (no-op idempotente). */
  | { ok: true; alreadyResolved: boolean }
  /** La RPC falló: NO se ha destruido nada, se puede reintentar entero. */
  | { ok: false; error: 'rpc_failed'; raw: unknown }
  /**
   * La anonimización SÍ se aplicó pero GoTrue no se pudo neutralizar. Estado a
   * vigilar: la cuenta parece borrada y sus credenciales siguen vivas. El caller
   * DEBE alertar; la RPC ya marcó la solicitud como `completed`, así que
   * `account_deletions_due()` no la volverá a sacar.
   */
  | { ok: false; error: 'auth_neutralize_failed'; raw: unknown };

/** Reintentos de la neutralización: es idempotente, así que reintentar es gratis. */
const AUTH_RETRIES = 3;

export async function finalizeAccountDeletionFromClient(
  admin: AdminClient,
  profileId: string,
  deps: {
    removeAvatar: AvatarRemover;
    neutralizeAuth: AuthNeutralizer;
    logError?: AccountDeletionLogger;
  },
): Promise<FinalizeAccountDeletionResult> {
  const logError = deps.logError ?? noopLog;

  // 1 · La transacción SQL. Lo primero: si falla, no se ha tocado nada.
  const { data: avatarPath, error } = await admin.rpc('finalize_account_deletion', {
    p_profile_id: profileId,
  });
  if (error) return { ok: false, error: 'rpc_failed', raw: error };

  // La RPC devuelve NULL también cuando no había solicitud pendiente (es idempotente
  // para el cron). No se puede distinguir de "no tenía avatar", así que se sigue
  // igual: los pasos 2 y 3 son idempotentes y seguros de repetir.
  const hadAvatar = typeof avatarPath === 'string' && avatarPath.length > 0;

  // 2 · El objeto de Storage. Best-effort: la anonimización YA está aplicada.
  if (hadAvatar) {
    try {
      await deps.removeAvatar(avatarPath);
    } catch (e) {
      logError(e, 'account_deletion_remove_avatar', { profileId, avatarPath });
    }
  }

  // 3 · GoTrue. Lo último y lo irreversible.
  let lastAuthError: unknown = null;
  for (let attempt = 1; attempt <= AUTH_RETRIES; attempt += 1) {
    try {
      await deps.neutralizeAuth(profileId);
      lastAuthError = null;
      break;
    } catch (e) {
      lastAuthError = e;
      logError(e, 'account_deletion_neutralize_auth', { profileId, attempt });
    }
  }
  if (lastAuthError) {
    return { ok: false, error: 'auth_neutralize_failed', raw: lastAuthError };
  }

  return { ok: true, alreadyResolved: !hadAvatar };
}
