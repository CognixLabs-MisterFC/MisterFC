import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@misterfc/core'],
  // Legal público: los .md (src/content/legal/) se leen con fs.readFileSync en el
  // Server Component; se fuerzan en el trace de despliegue para que Vercel los
  // empaquete (si no, la lectura fallaría en runtime).
  outputFileTracingIncludes: {
    '/[locale]/legal/privacidad': ['./src/content/legal/privacidad.md'],
    '/[locale]/legal/eliminacion-cuenta': ['./src/content/legal/eliminacion-cuenta.md'],
    '/[locale]/legal/terminos': ['./src/content/legal/terminos.md'],
    '/[locale]/legal/desistimiento': ['./src/content/legal/desistimiento.md'],
  },
  // F14-3c — el accept multi-hijo sube las fotos de los hijos por Server Action
  // (server-side con admin, porque el tutor aún no está vinculado). Cada foto
  // puede pesar hasta PLAYER_PHOTO_MAX_BYTES (2MB) y hay varias por lote; el
  // límite por defecto de Server Actions (1MB) se queda corto.
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
  // F9.B-6/7 — @react-pdf/renderer solo se usa en Route Handlers (runtime
  // nodejs); se externaliza para que no entre en el bundle de cliente/SSR.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Rework A (A4) — la nav gira en torno al equipo. /categorias se retira:
  //   · /categorias       → /equipos            (listado de equipos)
  //   · /categorias/[id]  → /equipos/plantillas (gestión de categorías)
  // 308 permanente. El locale va siempre en el path (localePrefix: 'always') y
  // los redirects de next.config se evalúan antes del middleware de next-intl.
  async redirects() {
    return [
      // Legal público: URLs LIMPIAS sin locale (registradas en Google Play/App
      // Store) → variante /es/ (los textos son español). Los redirects de
      // next.config se evalúan ANTES del middleware i18n → determinista y estable.
      {
        source: '/legal/:path*',
        destination: '/es/legal/:path*',
        permanent: true,
      },
      {
        source: '/:locale/categorias',
        destination: '/:locale/equipos',
        permanent: true,
      },
      {
        source: '/:locale/categorias/:categoryId',
        destination: '/:locale/equipos/plantillas',
        permanent: true,
      },

      // ─────────────────────────────────────────────────────────────────────
      // N-3a — LA RUTA ABRIDORA de una invitación.
      //
      // La pantalla nativa, cuando la invitación NO es de cuenta propia del menor,
      // manda al tutor al navegador. Pero `/{locale}/invite/{token}` lo reclama la
      // propia app (autoVerify en Android, AASA en iOS), así que abrirlo con
      // `Linking.openURL` puede devolverlo a la app, al mismo sitio del que venía.
      //
      // `abrir-invitacion` NO lo reclama nadie: el sistema lo entrega al navegador y
      // el salto a `/invite` ocurre ya DENTRO del navegador, donde ninguna de las dos
      // plataformas vuelve a repartir. El segmento y el enlace se escriben UNA vez,
      // en `packages/core/src/deep-links`, y hay un test que comprueba que sigue sin
      // estar reclamado por ninguna de las dos.
      //
      // TEMPORAL (307) Y NO PERMANENTE, a propósito: un 308 se queda cacheado en el
      // navegador indefinidamente, y si algún día hay que cambiar el destino —o
      // retirar esto porque el bucle aparezca igual— los que ya lo visitaron se
      // quedarían con el salto viejo grabado.
      //
      // El locale va acotado a los tres de la web para no capturar cualquier primer
      // segmento.
      {
        source: '/:locale(es|en|va)/abrir-invitacion/:token',
        destination: '/:locale/invite/:token',
        permanent: false,
      },
    ];
  },
};

const configWithIntl = withNextIntl(nextConfig);

// Sentry: solo activa el upload de source maps si las credenciales están disponibles.
// En CI/local sin SENTRY_AUTH_TOKEN simplemente no sube source maps.
export default withSentryConfig(configWithIntl, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
