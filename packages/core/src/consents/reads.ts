import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * RV-2 — los consentimientos que el tutor ha firmado, y el texto exacto que firmó.
 *
 * Las dos RPC existen desde F14-13 y hasta hoy SOLO las llamaba el perfil de la web
 * (`(authenticated)/perfil`). Traerlas a core es lo que permite que la app tenga la
 * misma pantalla — y es condición para poder cerrar la web a las familias (W-B): sin
 * esto, el corte les quitaría la única forma de consultar lo que consintieron, que es
 * justo lo que la Política de Privacidad promete.
 */
type DbClient = SupabaseClient<Database>;

export type ConsentType = Database['public']['Enums']['consent_type'];

/**
 * Los TRES que se pueden retirar. `terms_conditions` y `privacy_policy` no: retirarlos
 * no es revocar un tratamiento, es dejar de usar la plataforma — y para eso está el
 * borrado de cuenta. Es la misma regla que impone `revoke_player_consent` en SQL
 * (`not_revocable`), escrita aquí para poder pintar el botón solo donde procede. Hay un
 * test que compara las dos listas: si alguien cambia una, salta.
 */
export const REVOCABLE_CONSENT_TYPES = [
  'image_internal',
  'image_social',
  'medical_data_processing',
] as const satisfies readonly ConsentType[];

export function isRevocableConsent(t: ConsentType): boolean {
  return (REVOCABLE_CONSENT_TYPES as readonly ConsentType[]).includes(t);
}

/** Una decisión VIGENTE del tutor. Ya resuelta latest-wins por el SQL. */
export type TutorConsent = {
  /** `null` = consentimiento de la CUENTA (T&C, privacidad), no de un hijo. */
  playerId: string | null;
  playerName: string | null;
  consentType: ConsentType;
  /** `false` = retirado o denegado. El ledger no distingue una cosa de la otra. */
  granted: boolean;
  acceptedAt: string;
  /** Para pedir el texto exacto con `getAcceptedLegalDocumentFromClient`. */
  legalDocumentId: string;
  title: string;
};

export type TutorConsentsResult =
  | { ok: true; consents: TutorConsent[] }
  | { ok: false; reason: 'no_session' | 'error' };

/**
 * Dos motivos y no uno, por lo mismo de siempre: **una lista vacía es legítima**. Un
 * usuario que no es tutor de nadie —todo el cuerpo técnico— no tiene consentimientos, y
 * eso no es un fallo. Si un error de lectura se pintara igual que una lista vacía, la
 * pantalla diría «no has firmado nada» a alguien que sí firmó, que en un documento de
 * RGPD es exactamente la frase que no se puede decir por equivocación.
 */
export async function getTutorConsentsFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<TutorConsentsResult> {
  const { data, error } = await supabase.rpc('get_tutor_consents', { p_club_id: clubId });
  if (error) {
    return { ok: false, reason: error.message?.includes('no_session') ? 'no_session' : 'error' };
  }
  return {
    ok: true,
    consents: (data ?? []).map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name,
      consentType: r.consent_type,
      granted: r.granted,
      acceptedAt: r.accepted_at,
      legalDocumentId: r.legal_document_id,
      title: r.title,
    })),
  };
}

export type AcceptedLegalDocument = { title: string; body: string };

export type AcceptedLegalDocumentResult =
  | { ok: true; document: AcceptedLegalDocument }
  | { ok: false; reason: 'not_found' | 'error' };

/**
 * El texto EXACTO que se firmó, por `legal_document_id`.
 *
 * `get_legal_document_body` está gateada por «existe un consent de este tutor que lo
 * referencia», así que no hace falta comprobar nada aquí: pedir un documento ajeno
 * devuelve cero filas, no un error. Por eso `not_found` y `error` van separados — uno
 * significa «no es tuyo o ya no está» y el otro «no se pudo leer», y la pantalla los
 * dice distinto.
 */
export async function getAcceptedLegalDocumentFromClient(
  supabase: DbClient,
  legalDocumentId: string,
): Promise<AcceptedLegalDocumentResult> {
  const { data, error } = await supabase.rpc('get_legal_document_body', {
    p_legal_document_id: legalDocumentId,
  });
  if (error) return { ok: false, reason: 'error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, document: { title: row.title, body: row.body } };
}
