/**
 * RV-2 — consentimientos del tutor: consultarlos y retirarlos.
 *
 * Lectura en `reads` (qué firmó y el texto exacto), escritura en `actions` (retirar).
 * El SQL de la retirada es RV-1, migración `20261077000000`.
 */
export * from './actions';
export * from './reads';
