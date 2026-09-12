/**
 * SU-2 a SU-6b — suscripción anual (3 €/año).
 *
 * Cliente: la regla pura (`rules`), la lectura del estado (`reads`) y el gate (`gate`).
 *
 * Servidor (service-role / secret key, nunca desde la app): ingesta del webhook
 * (`webhook`), cliente REST (`revenuecat-api`), drenado de la cola de borrados
 * (`deletion-sweep`), proyección de la respuesta REST (`subscriber`), reconciliación
 * nocturna (`reconcile-sweep`), aviso de vencimiento (`expiring-notice`) y reclamación
 * "he pagado y sigo bloqueado" (`claim`).
 *
 * Decisión de fondo: `ADR-0022` · SQL: migraciones `20261063000000` (modelo),
 * `20261064000000` (tipo de aviso) y `20261065000000` (reconciliación y aviso).
 */
export * from './claim';
export * from './deletion-sweep';
export * from './expiring-notice';
export * from './gate';
export * from './reads';
export * from './reconcile-sweep';
export * from './revenuecat-api';
export * from './rules';
export * from './subscriber';
export * from './webhook';
