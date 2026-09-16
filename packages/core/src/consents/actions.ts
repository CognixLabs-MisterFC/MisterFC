import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { isRevocableConsent, type ConsentType } from './reads';

/**
 * RV-2 — retirar un consentimiento. Envoltorio de `revoke_player_consent`
 * (migración 20261077000000).
 *
 * La RPC ya impone todas las reglas: quién puede (el gate
 * `user_manages_player_sensitive`), qué se puede retirar, la idempotencia y —lo que no
 * se ve— sellar la fila con la temporada ACTIVA, que es lo que hace que
 * `user_has_medical_consent_write` se entere. Aquí NO se replica nada de eso: solo se
 * traducen los motivos, para que la pantalla pueda decir cosas distintas.
 *
 * La única comprobación local es `not_revocable`, y está por un motivo de interfaz y no
 * de seguridad: evita pintar un botón que la base va a rechazar. La autoridad sigue
 * siendo el SQL.
 */
type DbClient = SupabaseClient<Database>;

export type RevokeConsentResult =
  | { ok: true }
  | {
      ok: false;
      reason: /** No es tutor de ese jugador (o dejó de serlo). */
        | 'forbidden'
        /** Sin sesión. */
        | 'no_session'
        /** T&C o privacidad: eso es irse, y se hace desde el borrado de cuenta. */
        | 'not_revocable'
        /** No hay nada firmado que retirar. */
        | 'nothing_to_revoke'
        /** El club no tiene temporada activa: la retirada no se podría sellar. */
        | 'no_active_season'
        | 'error';
    };

function reasonOf(
  message: string | undefined,
): Exclude<Extract<RevokeConsentResult, { ok: false }>['reason'], never> {
  if (message?.includes('no_session')) return 'no_session';
  if (message?.includes('forbidden')) return 'forbidden';
  if (message?.includes('not_revocable')) return 'not_revocable';
  if (message?.includes('nothing_to_revoke')) return 'nothing_to_revoke';
  if (message?.includes('no_active_season')) return 'no_active_season';
  return 'error';
}

export async function revokePlayerConsentFromClient(
  supabase: DbClient,
  playerId: string,
  consentType: ConsentType,
): Promise<RevokeConsentResult> {
  if (!isRevocableConsent(consentType)) return { ok: false, reason: 'not_revocable' };

  const { error } = await supabase.rpc('revoke_player_consent', {
    p_player_id: playerId,
    p_consent_type: consentType,
  });
  if (error) return { ok: false, reason: reasonOf(error.message) };
  return { ok: true };
}
