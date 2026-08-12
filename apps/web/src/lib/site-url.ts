/**
 * URL pública canónica del sitio. Se usa en las páginas legales (canonical),
 * robots.ts y sitemap.ts. Producción: misterfc.es (dominio operado por Cognix
 * Labs, S.L. — ver Términos y Condiciones). Overridable por entorno para previews.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://misterfc.es';
