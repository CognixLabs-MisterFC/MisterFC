/**
 * Enlaces a los documentos legales públicos de la web.
 *
 * Nació en SU-7 para el MURO DE PAGO y vivía bajo `subscription/`. Lo usa ahora también
 * la pantalla de invitación (R-3), donde el menor acepta términos y privacidad al darse
 * de alta, así que deja de ser del muro y pasa a ser de la app. El fichero se mueve de
 * sitio y no cambia de comportamiento.
 *
 * D-2 — desde el formulario de desistimiento lo usa ademas el propio muro para un
 * TERCER enlace, y el Perfil para los cuatro. El documento de desistimiento tiene que
 * poder leerse ANTES de pagar (exigencia del abogado: no puede descubrirse solo despues
 * de comprar) y TAMBIEN despues, porque el plazo son catorce dias desde la contratacion
 * y quien ya paga deja de ver el muro en el mismo instante en que paga.
 *
 * No es adorno: Apple lo exige. Su documentación de suscripciones dice que «your app and
 * App Store metadata must include links to your Terms of Use and Privacy Policy», y una
 * suscripción auto-renovable sin esos dos enlaces EN EL BINARIO es un rechazo por
 * Guideline 3.1.2. Hasta SU-6b la app no tenía ni uno (la web sí: `/legal/*` es público
 * desde #453).
 *
 * POR QUÉ AQUÍ SÍ HAY HOST POR DEFECTO, cuando `server-api` prohíbe tenerlo: aquella
 * regla existe para no mandar NUNCA un token de sesión a un host equivocado. Esto es un
 * GET anónimo a una página pública, sin cabecera de autorización y sin datos. Y el
 * riesgo es el inverso: sin `EXPO_PUBLIC_WEB_URL` en el build, un enlace vacío es un
 * enlace roto en la pantalla de pago, y eso sí es un rechazo. Se prefiere la variable
 * cuando está, y si no, el dominio de producción.
 */

/** Dominio de producción. Es el mismo que sirve `/legal/*` y las fichas de las tiendas. */
export const LEGAL_FALLBACK_BASE = 'https://misterfc.es';

export type LegalDoc = 'terminos' | 'privacidad' | 'eliminacion-cuenta' | 'desistimiento';

export function legalBaseUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/+$/, '');
  return configured || LEGAL_FALLBACK_BASE;
}

/**
 * URL pública del documento en el idioma de la app. El locale va en la ruta porque las
 * páginas viven en `/[locale]/legal/...`; `appLocale()` nunca devuelve undefined, así que
 * aquí no se puede colar un `/undefined/legal/...`.
 */
export function legalUrl(doc: LegalDoc, locale: string): string {
  return `${legalBaseUrl()}/${locale}/legal/${doc}`;
}
