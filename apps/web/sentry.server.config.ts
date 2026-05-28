import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    debug: false,

    // Privacidad: no logueamos PII (emails, nombres, contenido de mensajes).
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
      }
      return event;
    },
  });
  // Línea visible en Vercel logs al arrancar el runtime. Solo dsn_present:
  // imprimir el DSN entero filtra una credencial (es secret-ish aunque sea pública).
  console.info('[sentry][server-init] initialized', {
    dsn_present: true,
    environment: process.env.NODE_ENV,
  });
} else {
  // Sin DSN → cualquier Sentry.captureException es un no-op silencioso.
  // Logueamos en error para que aparezca destacado en Vercel logs y permita
  // diagnosticar "Sentry no recibe eventos" en 1 búsqueda.
  console.error(
    '[sentry][server-init] NEXT_PUBLIC_SENTRY_DSN missing — Sentry server SDK NOT initialized. Events will NOT be sent.'
  );
}
