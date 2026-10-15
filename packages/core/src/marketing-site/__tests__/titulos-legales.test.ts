import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los títulos de las páginas legales llevan ya «— MisterFC». Pasaban además por la
 * plantilla del layout raíz («%s · MisterFC») y salía «… — MisterFC · MisterFC».
 * `legalMetadata` los marca como absolutos; aquí se vigila que siga así y que todas
 * las páginas legales pasen por él.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${process.cwd()}`);
}

const ROOT = repoRoot();
const LEGAL = join(ROOT, 'apps/web/src/app/[locale]/legal');
const paginas = readdirSync(LEGAL).filter((d) => existsSync(join(LEGAL, d, 'page.tsx')));

describe('títulos de las páginas legales', () => {
  it('premisa: están las 6 legales', () => {
    expect(paginas.sort()).toEqual([
      'aviso-legal',
      'cookies',
      'desistimiento',
      'eliminacion-cuenta',
      'privacidad',
      'terminos',
    ]);
  });

  it('legalMetadata usa el título absoluto, sin la plantilla del layout raíz', () => {
    const src = readFileSync(join(ROOT, 'apps/web/src/lib/legal-content.ts'), 'utf8');
    expect(src).toContain('title: { absolute: args.title }');
  });

  it.each(paginas)('%s pasa por legalMetadata con un título que acaba en «— MisterFC»', (p) => {
    const src = readFileSync(join(LEGAL, p, 'page.tsx'), 'utf8');
    expect(src).toContain('return legalMetadata({');
    expect(src).toMatch(/title: '[^']+ — MisterFC',/);
  });
});
