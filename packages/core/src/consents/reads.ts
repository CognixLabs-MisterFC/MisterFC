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

/**
 * RV-3 — LOS MISMOS TRES, mirados desde el otro lado. Un permiso opcional se puede
 * retirar y se puede conceder, así que la lista es la misma; el alias existe para que
 * los dos sitios que la usan se lean con el verbo que les toca, y hay un test que
 * compara las dos listas contra los `if` de las DOS migraciones (RV-1 y RV-3). Si
 * alguien separa una, salta.
 */
export const GRANTABLE_CONSENT_TYPES = REVOCABLE_CONSENT_TYPES;

export function isGrantableConsent(t: ConsentType): boolean {
  return (GRANTABLE_CONSENT_TYPES as readonly ConsentType[]).includes(t);
}

/**
 * Los tres estados en los que puede estar un permiso opcional. `never` es el que no
 * existía hasta RV-3: el ledger no tiene fila, así que la pantalla no tenía nada que
 * pintar y el permiso no se podía dar.
 */
export type ConsentOptionState = 'granted' | 'revoked' | 'never';

/** Una casilla de la rejilla: un hijo × un permiso opcional. */
export type ConsentOption = {
  playerId: string;
  playerName: string | null;
  consentType: ConsentType;
  state: ConsentOptionState;
  /** `null` cuando nunca se decidió. */
  decidedAt: string | null;
  /** El texto que se aceptó. `null` cuando nunca se decidió. */
  signedDocumentId: string | null;
  signedDocumentTitle: string | null;
  /**
   * El texto que se aceptaría, y el que `grantPlayerConsentFromClient` exige. `null`
   * cuando el club NO ha publicado ese documento: entonces no hay nada que conceder y
   * la pantalla lo dice en vez de ofrecer un botón que la base va a rechazar.
   */
  currentDocumentId: string | null;
  currentDocumentTitle: string | null;
};

export type TutorConsentOptionsResult =
  | { ok: true; options: ConsentOption[] }
  | { ok: false; reason: 'no_session' | 'error' };

const ESTADOS: readonly string[] = ['granted', 'revoked', 'never'];

/**
 * RV-3 — la rejilla completa: cada hijo cuyos datos sensibles maneja esta persona ×
 * los tres permisos opcionales, decididos o no.
 *
 * Por qué no vale `getTutorConsentsFromClient`: esa devuelve el LEDGER, y un permiso
 * que nunca se dio no está en el ledger. Medido en producción antes de escribir nada:
 * 6 de 21 combinaciones sin ninguna fila, dos jugadores enteros así y uno de ellos con
 * foto — que tras #622 no se ve y no había forma de que se viera.
 *
 * Un `state` que no sea uno de los tres devuelve `error` en vez de colarse: el valor
 * solo lo produce el `case` de la RPC, así que si llega otra cosa el contrato se ha
 * roto, y el fallo barato («no lo reconozco, lo trato como sin decidir») ofrecería
 * conceder algo cuyo estado real no conocemos.
 */
export async function getTutorConsentOptionsFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<TutorConsentOptionsResult> {
  const { data, error } = await supabase.rpc('get_tutor_consent_options', {
    p_club_id: clubId,
  });
  if (error) {
    return { ok: false, reason: error.message?.includes('no_session') ? 'no_session' : 'error' };
  }
  const filas = data ?? [];
  if (filas.some((r) => !ESTADOS.includes(r.state))) return { ok: false, reason: 'error' };
  return {
    ok: true,
    options: filas.map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name,
      consentType: r.consent_type,
      state: r.state as ConsentOptionState,
      decidedAt: r.decided_at,
      signedDocumentId: r.signed_document_id,
      signedDocumentTitle: r.signed_document_title,
      currentDocumentId: r.current_document_id,
      currentDocumentTitle: r.current_document_title,
    })),
  };
}

/**
 * RV-3 — el texto que se va a firmar, COMPLETO, antes de firmarlo.
 *
 * No usa `get_legal_document_body` y no es un despiste: esa RPC está gateada por
 * «existe un consent tuyo que referencia este documento», así que un texto que nunca
 * firmaste no se puede leer por ahí. Y conceder sin poder leer no es consentimiento.
 *
 * Se lee de la tabla porque la policy `legal_documents_select_own_club` ya lo permite a
 * cualquier miembro del club — comprobado que `authenticated` conserva el SELECT
 * después de #622, `body` incluido, y que los tutores de producción tienen membresía
 * viva. O sea: no hace falta abrir nada nuevo. Son dos preguntas distintas y cada una
 * tiene su puerta: «el texto que aceptaste» va por la RPC (prueba), «el texto que
 * aceptarías» por la tabla.
 */
export async function getLegalDocumentToSignFromClient(
  supabase: DbClient,
  legalDocumentId: string,
): Promise<AcceptedLegalDocumentResult> {
  const { data, error } = await supabase
    .from('legal_documents')
    .select('title, body')
    .eq('id', legalDocumentId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'error' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, document: { title: data.title, body: data.body } };
}
