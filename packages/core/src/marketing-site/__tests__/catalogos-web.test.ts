import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los textos de la web comercial (`apps/web/messages-web/{es,va,en}.json`) no pasan por
 * los guards del catálogo compartido. Este test cubre lo mínimo: los tres idiomas tienen
 * las MISMAS claves y ninguna está vacía. Una clave que falta en un idioma no da error en
 * el build: sale en pantalla el nombre de la clave.
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

type Catalogo = { [k: string]: string | Catalogo };

function hojas(c: Catalogo, prefijo = ''): [string, string][] {
  return Object.entries(c).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefijo + k, v] as [string, string]] : hojas(v, `${prefijo}${k}.`),
  );
}

const leer = (l: string) =>
  hojas(
    JSON.parse(
      readFileSync(join(repoRoot(), `apps/web/messages-web/${l}.json`), 'utf8'),
    ) as Catalogo,
  );

describe('catálogos de la web comercial', () => {
  const es = leer('es');

  it('premisa: el castellano tiene claves', () => {
    expect(es.length).toBeGreaterThan(0);
  });

  it.each(['va', 'en'])('%s tiene exactamente las claves del castellano', (l) => {
    expect(
      leer(l)
        .map(([k]) => k)
        .sort(),
    ).toEqual(es.map(([k]) => k).sort());
  });

  it.each(['es', 'va', 'en'])('%s no tiene textos vacíos', (l) => {
    expect(
      leer(l)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k),
    ).toEqual([]);
  });
});
