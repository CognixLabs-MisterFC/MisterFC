import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@misterfc/core'],
  async redirects() {
    return [
      // F4 Lote B — rename /mi-plantilla → /mis-equipos.
      // 308 (permanent + preserve method). Vive 30 días tras merge; ver
      // known-issues `F4b-redirect-mi-plantilla-cleanup` para retirarlo.
      {
        source: '/:locale(es|en|va)/mi-plantilla',
        destination: '/:locale/mis-equipos',
        permanent: true,
      },
      {
        source: '/:locale(es|en|va)/mi-plantilla/:path*',
        destination: '/:locale/mis-equipos/:path*',
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
