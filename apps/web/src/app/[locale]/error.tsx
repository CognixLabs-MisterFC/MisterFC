'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { ERROR_BOUNDARY_MESSAGES, resolveErrorLocale } from '@/lib/error-boundary-messages';

/**
 * Error boundary del subárbol [locale] (cubre todas las páginas con y sin sesión).
 * Antes NO existía: cualquier excepción de un Server Component (p. ej. el 500 del
 * home de dirección por `full_name` null) mostraba la pantalla cruda de Vercel. Ahora
 * se muestra un mensaje decente + botón de reintentar y se reporta a Sentry. Client
 * Component (obligatorio para un error boundary). i18n auto-contenido (ver
 * error-boundary-messages): un boundary no puede fiarse del runtime de i18n.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const params = useParams();
  const rawLocale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale;
  const m = ERROR_BOUNDARY_MESSAGES[resolveErrorLocale(rawLocale)];

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{m.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{m.description}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-misterfc-green px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:opacity-90"
      >
        {m.reload}
      </button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          {m.ref}: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
