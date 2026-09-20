import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * Textos legales públicos de Cognix Labs (política de privacidad, eliminación de
 * cuenta, términos). Se leen del sistema de ficheros en el Server Component
 * (build-time); los .md se fuerzan en el trace de despliegue vía
 * `outputFileTracingIncludes` (next.config). Server-only: usa fs.
 *
 * Legal-1 — `src/content/legal/*.md` NO se edita ni se versiona: lo GENERA el build
 * desde `Documentos/*.md`, los .md revisados por el abogado, que son la única copia
 * (scripts/generar-textos-legales.mjs, encadenado en `build` y `dev`). Editar aquí
 * es escribir en algo que la siguiente construcción pisa sin avisar; el texto se
 * cambia en Documentos/. El censo de qué .md alimenta a qué slug vive en
 * scripts/textos-legales.mjs y lo vigila `check:textos-legales`.
 *
 * NO es `legal_documents` (F14-11/12), que son los textos POR CLUB en la BD. Esto
 * son documentos estáticos, iguales para todos, del prestador de la plataforma.
 */
export type LegalSlug = 'privacidad' | 'eliminacion-cuenta' | 'terminos';

export function readLegalDoc(slug: LegalSlug): string {
  return readFileSync(join(process.cwd(), 'src/content/legal', `${slug}.md`), 'utf8');
}

/**
 * C-1 — Metadatos SEO de las tres páginas legales. Son el MISMO documento en
 * castellano en /es, /en y /va (`readLegalDoc` no recibe locale: hay un .md por
 * documento), así que:
 *
 *  · `canonical` apunta SIEMPRE a /es, también desde /es. Ya estaba así.
 *  · `index` SOLO en /es. El canonical es una PISTA, no una orden: con las tres
 *    rutas devolviendo 200, rastreo permitido y enlaces internos desde la app en
 *    cada idioma, Google indexaba /en y /va igualmente. El `noindex` sí es una
 *    orden.
 *  · `follow` se queda en las tres: que no se indexen no significa que no se
 *    sigan los enlaces cruzados del pie.
 *
 * Las URLs siguen respondiendo 200 a propósito (Google Play y App Store
 * comprueban que la URL de privacidad es accesible), y por eso robots.txt las
 * sigue PERMITIENDO: un `Disallow` impediría leer el propio `noindex`.
 */
export function legalMetadata(args: {
  slug: LegalSlug;
  locale: string;
  title: string;
  description: string;
}): Metadata {
  return {
    title: args.title,
    description: args.description,
    robots: { index: args.locale === 'es', follow: true },
    alternates: { canonical: `${SITE_URL}/es/legal/${args.slug}` },
  };
}
