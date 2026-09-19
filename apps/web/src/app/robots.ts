import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * robots.txt. Permite el rastreo (las páginas legales públicas deben ser
 * indexables — Google Play/App Store comprueban que la URL es accesible) y
 * apunta al sitemap. Se declara explícito para no depender de un default ausente.
 *
 * C-1 — /en/legal/ y /va/legal/ siguen PERMITIDAS a propósito, aunque sirvan el
 * mismo castellano y ya no se indexen: su `noindex` viaja en la propia página
 * (`legalMetadata`), y un `Disallow` aquí impediría leerlo — Google dejaría en
 * el índice lo que ya tiene, sin volver a mirar. Para sacar una URL del índice
 * hay que dejar entrar al robot.
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
