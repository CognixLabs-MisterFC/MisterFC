import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    debug: false,

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
  // En el cliente esto va a devtools del browser. Sirve como sanity-check en
  // producción: si abres el devtools y NO ves esta línea, el SDK no se cargó.
  console.info('[sentry][client-init] initialized', {
    dsn_present: true,
    environment: process.env.NODE_ENV,
  });
} else {
  console.warn(
    '[sentry][client-init] NEXT_PUBLIC_SENTRY_DSN missing — Sentry browser SDK NOT initialized. Client errors will NOT be sent.'
  );
}
