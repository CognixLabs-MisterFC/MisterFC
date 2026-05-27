// Sentry client-side initialization.
// Next.js carga este archivo automáticamente en el cliente (App Router).
import * as Sentry from '@sentry/nextjs';
import './sentry.client.config';

// Instrumentación de navegaciones (App Router).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
