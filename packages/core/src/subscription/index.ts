/**
 * SU-2/SU-3 — suscripción anual (3 €/año). La regla pura (`rules`), la lectura del
 * estado (`reads`), y la cocina de servidor: ingesta del webhook (`webhook`), cliente
 * REST (`revenuecat-api`) y drenado de la cola de borrados (`deletion-sweep`).
 *
 * Lo de servidor exige service-role / secret key y no se usa desde la app.
 *
 * Decisión de fondo: `ADR-0022` · SQL: migración `20261063000000`.
 */
export * from './deletion-sweep';
export * from './reads';
export * from './revenuecat-api';
export * from './rules';
export * from './webhook';
