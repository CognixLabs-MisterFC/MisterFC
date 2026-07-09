import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@misterfc/core'],
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
