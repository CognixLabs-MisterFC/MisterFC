// Sentry para apps/native (O2-12b). Réplica del criterio de la web
// (apps/web/sentry.client.config.ts), pero MÁS ESTRICTO en privacidad porque la
// app maneja datos de MENORES.
//
// Se inicializa como EFECTO al importar este módulo (lo hace el layout raíz lo
// antes posible). Si falta el DSN, la app arranca igual SIN Sentry (como la web).
//
// PRIVACIDAD (informes ANÓNIMOS):
//   · NUNCA se llama a Sentry.setUser (igual que la web).
//   · beforeSend borra `event.user` ENTERO — ni siquiera el id (más estricto que
//     la web, que borra email/username/ip campo a campo).
//   · Se eliminan cabeceras de autorización/cookies y se redacta cualquier token
//     tipo JWT/bearer (el de secure-store) que se cuele en eventos o breadcrumbs.
//   · Integraciones que capturan CONTENIDO de pantalla desactivadas explícitamente
//     (screenshot, view hierarchy, PII por defecto). Los breadcrumbs de red no
//     llevan cuerpo por defecto; además se les quita el query (URLs firmadas).
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Redacta JSON Web Tokens / tokens de aspecto bearer en cualquier string.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
function redact(value: string): string {
  return value.replace(JWT_RE, '[redacted-token]');
}

// Quita el query string de una URL (las URLs firmadas de Supabase Storage y los
// deep links llevan tokens ahí).
function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  const clean = q >= 0 ? url.slice(0, q) : url;
  return redact(clean);
}

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

    beforeSend(event) {
      // Informes ANÓNIMOS: fuera el usuario ENTERO (ni el id).
      delete event.user;
      // Cabeceras/cookies de autorización.
      if (event.request) {
        delete event.request.cookies;
        const h = event.request.headers as Record<string, unknown> | undefined;
        if (h) {
          delete h['Authorization'];
          delete h['authorization'];
          delete h['Cookie'];
          delete h['cookie'];
        }
        event.request.url = stripQuery(event.request.url) as string | undefined;
      }
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // Breadcrumbs de red: quita el query (tokens de URLs firmadas) y cualquier
      // cabecera de autorización que el SDK pudiera adjuntar.
      if (
        breadcrumb.category === 'http' ||
        breadcrumb.category === 'xhr' ||
        breadcrumb.category === 'fetch'
      ) {
        const data = breadcrumb.data as Record<string, unknown> | undefined;
        if (data) {
          if ('url' in data) data.url = stripQuery(data.url);
          delete data['Authorization'];
          delete data['authorization'];
        }
      }
      // Red de seguridad: redacta tokens en el texto del breadcrumb.
      if (typeof breadcrumb.message === 'string') {
        breadcrumb.message = redact(breadcrumb.message);
      }
      return breadcrumb;
    },
  });
} else if (!__DEV__) {
  // Sanity en producción: si no ves esto, es que faltó el DSN y NO se envía nada.
  console.warn(
    '[sentry][native-init] EXPO_PUBLIC_SENTRY_DSN missing — Sentry NOT initialized. Native errors will NOT be sent.',
  );
}
