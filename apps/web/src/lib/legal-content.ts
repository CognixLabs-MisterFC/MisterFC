import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Textos legales públicos de Cognix Labs (política de privacidad, eliminación de
 * cuenta, términos). Copia VERBATIM de los .md revisados por el abogado
 * (Documentos/), en src/content/legal/. Se leen del sistema de ficheros en el
 * Server Component (build-time); los .md se fuerzan en el trace de despliegue vía
 * `outputFileTracingIncludes` (next.config). Server-only: usa fs.
 *
 * NO es `legal_documents` (F14-11/12), que son los textos POR CLUB en la BD. Esto
 * son documentos estáticos, iguales para todos, del prestador de la plataforma.
 */
export type LegalSlug = 'privacidad' | 'eliminacion-cuenta' | 'terminos';

export function readLegalDoc(slug: LegalSlug): string {
  return readFileSync(join(process.cwd(), 'src/content/legal', `${slug}.md`), 'utf8');
}
