import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@misterfc/core'],
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
