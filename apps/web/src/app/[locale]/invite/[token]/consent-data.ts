import 'server-only';
import { createSupabaseAdminClient } from '@misterfc/core';

/**
 * F14-2 — datos de los consentimientos OBLIGATORIOS a nivel de cuenta (T&C +
 * Privacidad) para el paso final del alta. Se lee con service_role porque la
 * página de invitación puede no tener sesión (invitee nuevo) y legal_documents
 * solo permite SELECT a authenticated.
 */

export type AccountConsentDoc = {
  /** consent_type que se registra al aceptar. */
  consentType: 'terms_conditions' | 'privacy_policy';
  /** Versión VIGENTE (max(version) por doc_type). */
  version: number;
  title: string;
  body: string;
};

export type AccountConsentDocs = {
  terms: AccountConsentDoc | null;
  privacy: AccountConsentDoc | null;
};

/** Versión vigente (mayor `version`) de T&C y Privacidad DEL CLUB, con su texto. */
export async function loadCurrentLegalDocs(clubId: string): Promise<AccountConsentDocs> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('legal_documents')
    .select('doc_type, version, title, body')
    .eq('club_id', clubId)
    .in('doc_type', ['terms_conditions', 'privacy_policy'])
    .order('version', { ascending: false });

  const rows = data ?? [];
  const pick = (docType: 'terms_conditions' | 'privacy_policy'): AccountConsentDoc | null => {
    // rows viene ordenado por version desc → el primero de cada tipo es el vigente.
    const r = rows.find((x) => x.doc_type === docType);
    return r ? { consentType: docType, version: r.version, title: r.title, body: r.body } : null;
  };

  return { terms: pick('terms_conditions'), privacy: pick('privacy_policy') };
}

/**
 * F14-3c — Documentos de consentimiento de IMAGEN (interna / redes) por hijo. Se
 * enlazan en cada tarjeta del accept para que el tutor lea el texto vigente antes
 * de decidir sí/no. Mismo patrón que loadCurrentLegalDocs (service_role).
 */
export type ImageConsentDoc = {
  consentType: 'image_internal' | 'image_social';
  version: number;
  title: string;
  body: string;
};

export type ImageConsentDocs = {
  internal: ImageConsentDoc | null;
  social: ImageConsentDoc | null;
};

export async function loadImageLegalDocs(clubId: string): Promise<ImageConsentDocs> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('legal_documents')
    .select('doc_type, version, title, body')
    .eq('club_id', clubId)
    .in('doc_type', ['image_internal', 'image_social'])
    .order('version', { ascending: false });

  const rows = data ?? [];
  const pick = (docType: 'image_internal' | 'image_social'): ImageConsentDoc | null => {
    const r = rows.find((x) => x.doc_type === docType);
    return r ? { consentType: docType, version: r.version, title: r.title, body: r.body } : null;
  };

  return { internal: pick('image_internal'), social: pick('image_social') };
}

/**
 * F14-4 — Documento de CONSENTIMIENTO INFORMADO de datos médicos (vigente). Se
 * enseña ANTES de pedir nada (informado). La médica es opcional y no bloquea.
 */
export type MedicalConsentDoc = { version: number; title: string; body: string };

export async function loadMedicalLegalDoc(clubId: string): Promise<MedicalConsentDoc | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('legal_documents')
    .select('version, title, body')
    .eq('club_id', clubId)
    .eq('doc_type', 'medical_informed_consent')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { version: data.version, title: data.title, body: data.body } : null;
}

/**
 * ¿El tutor ya tiene el consentimiento de cuenta (player_id NULL, granted=true) de
 * cada documento EN LA TEMPORADA ACTIVA del club? Solo tiene sentido si ya hay
 * sesión (flujos con sesión).
 *
 * MISMO CRITERIO QUE LA RPC, y de ahí viene el arreglo. Esta pantalla decidía por
 * VERSIÓN del documento y `accept_pending_invitations` decide por TEMPORADA:
 *
 *   not exists (… consent_type = 'terms_conditions' and granted and season_id = v_season)
 *
 * Dos preguntas distintas para la misma decisión. Mientras versión y temporada
 * cambian a la vez nadie lo nota; pero al empezar temporada NUEVA sin publicar
 * versión nueva de los Términos —lo normal, una temporada no obliga a reescribirlos—
 * la pantalla daba el consentimiento por aceptado, NO pintaba la casilla, el
 * formulario mandaba `accept_terms=false` y la RPC lo exigía igual: `consent_required`
 * y un mensaje pidiendo marcar una casilla QUE NO ESTÁ EN PANTALLA. Callejón sin
 * salida, y la transacción revierte sin dejar rastro de por qué.
 *
 * La temporada se pide a `active_season_id`, la MISMA función que usa la RPC, y no a
 * una consulta equivalente: si un día cambia el criterio de "temporada activa", las
 * dos cambian juntas por construcción.
 *
 * Sin temporada activa se devuelve `false` en las dos: la RPC ni siquiera llegaría a
 * mirar los consentimientos (lanza `no_active_season` antes), y pintar la casilla deja
 * al tutor con algo que hacer en vez de con un botón que no funciona.
 */
export async function loadAccountConsentStatus(
  profileId: string,
  clubId: string,
): Promise<{ termsAccepted: boolean; privacyAccepted: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: seasonId } = await admin.rpc('active_season_id', { p_club_id: clubId });
  if (!seasonId) return { termsAccepted: false, privacyAccepted: false };

  const { data } = await admin
    .from('consents')
    .select('consent_type')
    .eq('tutor_profile_id', profileId)
    .is('player_id', null)
    .eq('granted', true)
    .eq('season_id', seasonId)
    .in('consent_type', ['terms_conditions', 'privacy_policy']);

  const rows = data ?? [];
  const has = (type: string) => rows.some((r) => r.consent_type === type);

  return {
    termsAccepted: has('terms_conditions'),
    privacyAccepted: has('privacy_policy'),
  };
}
