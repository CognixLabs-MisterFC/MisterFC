/**
 * Legal-1 — El CENSO de los textos legales y el generador de la copia que se sirve.
 *
 * Un texto legal tenía dos copias en el repo: `Documentos/*.md`, los .md revisados
 * por el abogado, y `apps/web/src/content/legal/*.md`, la que leen las páginas
 * públicas. Idénticas byte a byte, y la garantía de que lo siguieran siendo era un
 * guard que las comparaba… después de que alguien se acordara de copiar a mano.
 *
 * Ahora hay UNA copia. La segunda se GENERA en el build (y en `dev`) desde la
 * maestra, así que no puede divergir: no existe hasta que se copia. Este fichero es
 * la única fuente del censo — lo usan el generador y el guard.
 *
 * Por qué sigue haciendo falta copiar: `readLegalDoc` lee de `process.cwd()` de
 * apps/web y los .md se fuerzan en el trace de despliegue con
 * `outputFileTracingIncludes` (next.config), que son rutas relativas al paquete. La
 * maestra vive en la raíz del monorepo y ahí no la alcanza ninguna de las dos cosas.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const MAESTRA_DIR = join(ROOT, 'Documentos');
/** Carpeta GENERADA: no se versiona (.gitignore) y el build la reescribe entera. */
export const SERVIDA_DIR = join(ROOT, 'apps/web/src/content/legal');
export const SERVIDA_REL = 'apps/web/src/content/legal';

/**
 * El censo. `servido: null` = ese documento NO se publica en la web, y se declara
 * para que conste que la ausencia es a propósito y no un olvido.
 *
 * `servido` es el SLUG: el nombre del .md generado y el valor de `LegalSlug`.
 */
export const PARES = [
  { maestra: 'misterfc-politica-privacidad.md', servido: 'privacidad' },
  { maestra: 'misterfc-terminos-condiciones.md', servido: 'terminos' },
  { maestra: 'misterfc-eliminacion-cuenta.md', servido: 'eliminacion-cuenta' },
  { maestra: 'misterfc-formulario-desistimiento.md', servido: 'desistimiento' },
  {
    maestra: 'misterfc-contrato-encargo-tratamiento.md',
    servido: null,
    // Anexo de protección de datos que se firma con cada club (art. 28 RGPD). No es
    // una página pública: es una plantilla en blanco que se rellena por club.
    motivo: 'contrato que se firma con cada club, no es una página pública',
  },
];

/** Pares que SÍ se publican. */
export const SERVIDOS = PARES.filter((p) => p.servido !== null);

/**
 * Copia cada maestra sobre su texto servido. Devuelve lo que hizo, para que el
 * caller lo cuente.
 *
 * Escribe SIEMPRE, también si el contenido coincide: el coste es de microsegundos y
 * la alternativa —comparar antes— deja la puerta abierta a que una copia manipulada
 * a mano con el mismo tamaño sobreviva al build.
 */
export function generar() {
  mkdirSync(SERVIDA_DIR, { recursive: true });
  const escritos = [];
  for (const par of SERVIDOS) {
    const origen = join(MAESTRA_DIR, par.maestra);
    if (!existsSync(origen)) {
      throw new Error(
        `falta la copia maestra Documentos/${par.maestra}. Sin ella la página legal ` +
          `'${par.servido}' no se puede construir: readLegalDoc('${par.servido}') ` +
          `reventaría al hacer el build.`,
      );
    }
    const texto = readFileSync(origen);
    writeFileSync(join(SERVIDA_DIR, `${par.servido}.md`), texto);
    escritos.push({ slug: par.servido, maestra: par.maestra, bytes: texto.length });
  }
  return escritos;
}
