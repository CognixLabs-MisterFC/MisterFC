import type { MetadataRoute } from 'next';
import { isMarketingSiteOn, marketingSitemapEntries } from '@misterfc/core';
import { SITE_URL } from '@/lib/site-url';

/**
 * Sitemap. Lista las CUATRO páginas legales públicas (URLs 200 servidas en /es/,
 * el idioma de los textos). Las URLs limpias sin locale (/legal/...) redirigen
 * a estas (308 permanente, next.config). `lastModified` = fecha de la última
 * revisión legal de los documentos.
 *
 * Web comercial (spec §11), solo con `MARKETING_SITE` encendida: la portada,
 * funciones, seguridad y demo en los 3 idiomas con sus alternates, y las 6 legales
 * —con 'aviso-legal' y 'cookies'— en /es. Apagada, el sitemap es el de siempre.
 */
const LAST_MODIFIED = '2026-09-24';

const SLUGS = ['privacidad', 'terminos', 'eliminacion-cuenta', 'desistimiento'] as const;

/** Las legales de la web comercial: solo con la web encendida. */
const SLUGS_WEB = ['aviso-legal', 'cookies'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const legal = (slug: string): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}/es/legal/${slug}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'yearly',
    priority: 0.5,
  });
  if (!isMarketingSiteOn(process.env)) return SLUGS.map(legal);
  return [...marketingSitemapEntries(SITE_URL), ...[...SLUGS, ...SLUGS_WEB].map(legal)];
}
