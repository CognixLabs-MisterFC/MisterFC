/**
 * Selector de idioma de la web comercial: la MISMA página en otro idioma (spec §3.3).
 *
 * Los slugs no se traducen (decisión 2), así que basta con cambiar el primer segmento:
 * `/es/funciones` → `/va/funciones`. La portada se ve en `/{idioma}` (el rewrite no
 * cambia la URL del navegador), así que `/es` → `/va`.
 *
 * Una ruta sin idioma reconocible lleva a la raíz del idioma pedido: nunca a una URL
 * inventada.
 */
export function localeSwitchHref(
  pathname: string,
  target: string,
  locales: readonly string[],
): string {
  const [, first, ...rest] = pathname.split('/');
  if (first === undefined || !locales.includes(first)) return `/${target}`;
  const tail = rest.filter((s) => s !== '');
  return tail.length === 0 ? `/${target}` : `/${target}/${tail.join('/')}`;
}

/** Distintivo oficial de cada tienda por idioma. Valenciano: los catalanes (`ca`). */
export const STORE_BADGE_LOCALE = {
  es: { apple: 'es-es', google: 'es' },
  va: { apple: 'ca-es', google: 'ca' },
  en: { apple: 'en-us', google: 'en' },
} as const satisfies Record<string, { apple: string; google: string }>;
