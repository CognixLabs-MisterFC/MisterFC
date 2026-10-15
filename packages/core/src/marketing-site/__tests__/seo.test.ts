import { describe, expect, it } from 'vitest';
import {
  HREFLANG,
  MARKETING_INDEXABLE_PATHS,
  marketingLanguages,
  marketingSitemapEntries,
} from '../seo';

const SITE = 'https://misterfc.es';

describe('SEO de la web comercial', () => {
  it('va se publica como ca (va no es un código hreflang)', () => {
    expect(HREFLANG).toEqual({ es: 'es', va: 'ca', en: 'en' });
  });

  it('hreflang de una página: los tres idiomas y x-default al castellano', () => {
    expect(marketingLanguages(SITE, '/funciones')).toEqual({
      es: 'https://misterfc.es/es/funciones',
      ca: 'https://misterfc.es/va/funciones',
      en: 'https://misterfc.es/en/funciones',
      'x-default': 'https://misterfc.es/es/funciones',
    });
  });

  it('la portada es /{idioma}, nunca /portada', () => {
    expect(marketingLanguages(SITE, '').ca).toBe('https://misterfc.es/va');
    const urls = marketingSitemapEntries(SITE).map((e) => e.url);
    expect(urls.some((u) => u.includes('portada'))).toBe(false);
  });

  it('sitemap: las 4 páginas en los 3 idiomas, sin /demo/gracias', () => {
    const urls = marketingSitemapEntries(SITE).map((e) => e.url);
    expect(MARKETING_INDEXABLE_PATHS).toHaveLength(4);
    expect(urls).toHaveLength(12);
    expect(urls).toContain('https://misterfc.es/en/demo');
    expect(urls.some((u) => u.includes('gracias'))).toBe(false);
  });
});
