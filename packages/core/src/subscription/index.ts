/**
 * SU-2 — suscripción anual (3 €/año). La regla pura (`rules`) y la lectura del estado
 * (`reads`). El gate de interfaz va en SU-4 (nativa) y SU-5 (web); la ingesta de
 * webhooks, en SU-3.
 *
 * Decisión de fondo: `ADR-0022` · SQL: migración `20261063000000`.
 */
export * from './reads';
export * from './rules';
