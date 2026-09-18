/**
 * Consentimientos del tutor: consultarlos, retirarlos y concederlos.
 *
 * Lectura en `reads` (qué firmó, el texto exacto, la rejilla de lo que falta y el texto
 * que se firmaría), escritura en `actions` (retirar y conceder).
 *
 * El SQL: la retirada es RV-1, migración `20261077000000`; la concesión y la rejilla
 * son RV-3, migración `20261084000000`.
 */
export * from './actions';
export * from './reads';
