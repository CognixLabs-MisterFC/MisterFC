/**
 * SEO de la web comercial (spec §11): hreflang, canonical y las entradas del sitemap.
 *
 * `va` no es un código hreflang válido: el valenciano se publica como `ca` (decisión 3),
 * igual que en NIDO. `x-default` es la versión en castellano.
 */
export const HREFLANG = { es: 'es', va: 'ca', en: 'en' } as const;

/** `og:locale` de cada idioma. */
export const OG_LOCALE = { es: 'es_ES', va: 'ca_ES', en: 'en_GB' } as const;

export type MarketingLocale = keyof typeof HREFLANG;

/**
 * Páginas comerciales que se indexan, como ruta tras el idioma. La portada es `''`: se
 * ve en `/{idioma}` y canoniza ahí, nunca a `/portada`. `/demo/gracias` no se indexa.
 */
export const MARKETING_INDEXABLE_PATHS = ['', '/funciones', '/seguridad', '/demo'] as const;

/** URL de una página comercial en un idioma. */
export function marketingUrl(siteUrl: string, locale: MarketingLocale, path: string): string {
  return `${siteUrl}/${locale}${path}`;
}

/** Los `hreflang` de una página: uno por idioma y `x-default` → castellano. */
export function marketingLanguages(siteUrl: string, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, code] of Object.entries(HREFLANG) as [MarketingLocale, string][]) {
    out[code] = marketingUrl(siteUrl, locale, path);
  }
  out['x-default'] = marketingUrl(siteUrl, 'es', path);
  return out;
}

export type SitemapEntry = {
  url: string;
  lastModified?: string;
  changeFrequency?: 'monthly' | 'yearly';
  priority?: number;
  alternates?: { languages: Record<string, string> };
};

/**
 * Entradas del sitemap que añade la web comercial: cada página comercial en los 3
 * idiomas, con sus alternates. Las legales las pone `sitemap.ts`.
 */
export function marketingSitemapEntries(siteUrl: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const path of MARKETING_INDEXABLE_PATHS) {
    const languages = marketingLanguages(siteUrl, path);
    for (const locale of Object.keys(HREFLANG) as MarketingLocale[]) {
      out.push({
        url: marketingUrl(siteUrl, locale, path),
        changeFrequency: 'monthly',
        priority: path === '' ? 1 : 0.8,
        alternates: { languages },
      });
    }
  }
  return out;
}
