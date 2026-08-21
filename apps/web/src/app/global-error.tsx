'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ERROR_BOUNDARY_MESSAGES, resolveErrorLocale } from '@/lib/error-boundary-messages';

/**
 * Error boundary GLOBAL: captura los fallos del propio root layout (donde
 * `[locale]/error.tsx` ya no llega). Reemplaza a todo el documento, así que DEBE
 * renderizar <html>/<body> y usa estilos INLINE (ni globals.css ni Tailwind están
 * garantizados aquí). Reporta a Sentry. i18n auto-contenido; el idioma se lee del
 * primer segmento del path (no hay params en el root).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const seg =
    typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : 'es';
  const locale = resolveErrorLocale(seg);
  const m = ERROR_BOUNDARY_MESSAGES[locale];

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          backgroundColor: '#0F1B2E',
          color: '#ffffff',
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{m.title}</h1>
        <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#a1a1aa', margin: 0 }}>
          {m.description}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: 'none',
            borderRadius: '0.375rem',
            backgroundColor: '#10B981',
            color: '#18181b',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {m.reload}
        </button>
        {error.digest ? (
          <p style={{ fontSize: '0.75rem', color: '#71717a', margin: 0 }}>
            {m.ref}: {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
