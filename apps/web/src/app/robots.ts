import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * robots.txt. Permite el rastreo (las páginas legales públicas deben ser
 * indexables — Google Play/App Store comprueban que la URL es accesible) y
 * apunta al sitemap. Se declara explícito para no depender de un default ausente.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal/', '/es/legal/', '/en/legal/', '/va/legal/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
