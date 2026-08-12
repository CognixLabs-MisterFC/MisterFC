import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * Sitemap. Lista las tres páginas legales públicas (URLs 200 servidas en /es/,
 * el idioma de los textos). Las URLs limpias sin locale (/legal/...) redirigen
 * a estas (308 permanente, next.config). `lastModified` = fecha de la última
 * revisión legal de los documentos.
 */
const LAST_MODIFIED = '2026-08-12';

const SLUGS = ['privacidad', 'terminos', 'eliminacion-cuenta'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return SLUGS.map((slug) => ({
    url: `${SITE_URL}/es/legal/${slug}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'yearly',
    priority: 0.5,
  }));
}
