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
  console.info('[sentry][edge-init] initialized', {
    dsn_present: true,
    environment: process.env.NODE_ENV,
  });
} else {
  console.error(
    '[sentry][edge-init] NEXT_PUBLIC_SENTRY_DSN missing — Sentry edge SDK NOT initialized. Events will NOT be sent.'
  );
}
