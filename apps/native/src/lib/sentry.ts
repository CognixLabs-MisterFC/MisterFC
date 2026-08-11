// Sentry para apps/native (O2-12b). Réplica del criterio de la web
// (apps/web/sentry.client.config.ts), pero MÁS ESTRICTO en privacidad porque la
// app maneja datos de MENORES.
//
// Este fichero es solo el WIRING de Sentry.init (efecto al importar). Toda la
// lógica pura de redacción/anonimización vive en `sentry-redact.ts` (sin
// importar @sentry/react-native), donde está testeada de forma aislada.
//
// Se inicializa como EFECTO al importar este módulo (lo hace el layout raíz lo
// antes posible). Si falta el DSN, la app arranca igual SIN Sentry (como la web).
//
// PRIVACIDAD (informes ANÓNIMOS):
//   · NUNCA se llama a Sentry.setUser (igual que la web).
//   · sanitizeEvent borra `event.user` ENTERO — ni siquiera el id (más estricto
//     que la web, que borra email/username/ip campo a campo).
//   · Se eliminan cabeceras de autorización/cookies y se redacta cualquier token
//     tipo JWT/bearer que se cuele en eventos (message, logentry, exception
//     values) o breadcrumbs, además de los query string de URLs firmadas.
//   · Integraciones que capturan CONTENIDO de pantalla desactivadas explícitamente
//     (screenshot, view hierarchy, PII por defecto). Los breadcrumbs de red no
//     llevan cuerpo por defecto; además se les quita el query (URLs firmadas).
import * as Sentry from '@sentry/react-native';

import { sanitizeBreadcrumb, sanitizeEvent } from './sentry-redact';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Nada en desarrollo; activo solo en builds reales.
    enabled: !__DEV__,
    environment: __DEV__ ? 'development' : 'production',
    // Igual que la web: 0.1 en producción.
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
    debug: false,

    // --- Privacidad: apagar toda captura de CONTENIDO de usuario ---
    // (sus defaults ya son off, pero lo dejamos EXPLÍCITO y auditable).
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Session Replay NO se habilita (replaysSessionSampleRate/replaysOnErrorSampleRate
    // se dejan sin definir = desactivado): grabaría la pantalla (nombres, notas
    // médicas, fotos de menores).

    // Anonimización + scrubbing de tokens/queries (lógica pura y testeada).
    beforeSend(event) {
      return sanitizeEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb);
    },
  });
} else if (!__DEV__) {
  // Sanity en producción: si no ves esto, es que faltó el DSN y NO se envía nada.
  console.warn(
    '[sentry][native-init] EXPO_PUBLIC_SENTRY_DSN missing — Sentry NOT initialized. Native errors will NOT be sent.',
  );
}
