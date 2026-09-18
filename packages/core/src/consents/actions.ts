import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { isGrantableConsent, isRevocableConsent, type ConsentType } from './reads';

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

/**
 * RV-3 — conceder un consentimiento. Envoltorio de `grant_player_consent`
 * (migración 20261084000000).
 *
 * Mismo reparto que en la retirada: la RPC impone todas las reglas —el gate, qué se
 * puede conceder, la idempotencia, el documento vigente y la temporada activa— y aquí
 * solo se traducen los motivos para que la pantalla pueda decir cosas distintas.
 *
 * `legalDocumentId` NO es decorativo y no se puede inventar desde aquí: es el id del
 * texto que la pantalla acaba de ENSEÑAR, y la RPC lo compara con el vigente. Si el
 * club publicó una versión nueva mientras el modal estaba abierto, devuelve
 * `document_changed` y no sella nada — el ledger prueba que se aceptó el texto que se
 * leyó, y eso es todo su valor.
 */
export type GrantConsentResult =
  | { ok: true }
  | {
      ok: false;
      reason: /** No es tutor de ese jugador (o dejó de serlo). */
        | 'forbidden'
        /** Sin sesión. */
        | 'no_session'
        /** T&C o privacidad: son obligatorios y se aceptan en el alta o en el anual. */
        | 'not_grantable'
        /** El club no ha publicado ese texto. No hay nada que conceder. */
        | 'no_document'
        /** El club publicó una versión nueva: hay que volver a leerla. */
        | 'document_changed'
        /** El club no tiene temporada activa: la concesión no se podría sellar. */
        | 'no_active_season'
        | 'error';
    };

function grantReasonOf(
  message: string | undefined,
): Extract<GrantConsentResult, { ok: false }>['reason'] {
  if (message?.includes('no_session')) return 'no_session';
  if (message?.includes('forbidden')) return 'forbidden';
  if (message?.includes('not_grantable')) return 'not_grantable';
  if (message?.includes('no_document')) return 'no_document';
  if (message?.includes('document_changed')) return 'document_changed';
  if (message?.includes('no_active_season')) return 'no_active_season';
  return 'error';
}

export async function grantPlayerConsentFromClient(
  supabase: DbClient,
  playerId: string,
  consentType: ConsentType,
  legalDocumentId: string,
): Promise<GrantConsentResult> {
  if (!isGrantableConsent(consentType)) return { ok: false, reason: 'not_grantable' };

  const { error } = await supabase.rpc('grant_player_consent', {
    p_player_id: playerId,
    p_consent_type: consentType,
    p_legal_document_id: legalDocumentId,
  });
  if (error) return { ok: false, reason: grantReasonOf(error.message) };
  return { ok: true };
}
