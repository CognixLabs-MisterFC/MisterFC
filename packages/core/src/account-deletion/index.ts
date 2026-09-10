/**
 * BC-2 — borrado de cuenta (Apple 5.1.1 v). Lecturas (preview + estado) y escrituras
 * (pedir + cancelar) del usuario. El finalizador con service_role (`finalize.ts`) es solo de servidor.
 * Spec: `docs/specs/BC.0-borrado-de-cuenta.md` · decisión: `ADR-0021`.
 */
export * from './actions';
export * from './finalize';
export * from './reads';
