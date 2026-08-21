/**
 * Copias AUTO-CONTENIDAS (es/en/va) para los error boundaries de la app.
 *
 * A propósito NO usan next-intl: un error boundary puede dispararse precisamente
 * cuando el layout o el proveedor de i18n han fallado (o en `global-error`, que
 * reemplaza al root layout y no tiene proveedor). Depender del runtime de traducción
 * ahí arriesga un segundo crash. Por eso las 3 cadenas viven inline aquí y el idioma
 * se resuelve del path (/es, /en, /va). Es la excepción justificada a la regla de
 * "todo al catálogo compartido".
 */
export type ErrorBoundaryLocale = 'es' | 'en' | 'va';

export const ERROR_BOUNDARY_MESSAGES: Record<
  ErrorBoundaryLocale,
  { title: string; description: string; reload: string; ref: string }
> = {
  es: {
    title: 'Algo ha fallado',
    description: 'No hemos podido cargar la página. Vuelve a intentarlo en unos segundos.',
    reload: 'Reintentar',
    ref: 'Referencia',
  },
  en: {
    title: 'Something went wrong',
    description: "We couldn't load the page. Please try again in a few seconds.",
    reload: 'Try again',
    ref: 'Reference',
  },
  va: {
    title: 'Alguna cosa ha fallat',
    description: 'No hem pogut carregar la pàgina. Torna-ho a provar en uns segons.',
    reload: 'Reintentar',
    ref: 'Referència',
  },
};

/** Resuelve el idioma del boundary desde el primer segmento del path (fallback es). */
export function resolveErrorLocale(input?: string | null): ErrorBoundaryLocale {
  const l = (input ?? '').slice(0, 2).toLowerCase();
  return l === 'en' || l === 'va' ? l : 'es';
}
