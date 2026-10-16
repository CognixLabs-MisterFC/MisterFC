import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Las capturas de la web comercial (spec §9.4 y §9.5) se declaran en
 * `apps/web/src/components/web/captures.ts` con su fichero y sus medidas, que
 * `next/image` usa para reservar el hueco. Aquí se vigila que cada fichero declarado
 * exista, sea WebP y mida lo que dice el código, y que no sobre ninguno en la carpeta.
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
const PUBLIC = join(ROOT, 'apps/web/public');
const fuente = readFileSync(join(ROOT, 'apps/web/src/components/web/captures.ts'), 'utf8');

/** Cada `src` declarado con su ancho y alto. */
const declaradas = [...fuente.matchAll(/src: '([^']+)',\s*width: (\d+),\s*height: (\d+)/g)].map(
  (m) => ({ src: m[1] as string, width: Number(m[2]), height: Number(m[3]) }),
);

/** Medidas de un WebP, leídas de su cabecera (VP8, VP8L o VP8X). */
function medidasWebp(buf: Buffer): { width: number; height: number } {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  throw new Error(`cabecera WebP desconocida: ${chunk}`);
}

describe('capturas de la web comercial', () => {
  it('premisa: están declaradas las 13 capturas y las 5 versiones móviles de las web', () => {
    const ids = [...fuente.matchAll(/^ {2}(C\d+|M\d+): \{/gm)].map((m) => m[1]);
    expect(ids).toHaveLength(13);
    expect(declaradas).toHaveLength(18);
  });

  it.each(declaradas)('$src existe, es WebP y mide $width×$height', ({ src, width, height }) => {
    const ruta = join(PUBLIC, src);
    expect(existsSync(ruta)).toBe(true);
    expect(medidasWebp(readFileSync(ruta))).toEqual({ width, height });
  });

  it('no sobra ningún fichero en public/web/capturas', () => {
    const enCarpeta = readdirSync(join(PUBLIC, 'web/capturas')).map((f) => `/web/capturas/${f}`);
    expect(enCarpeta.sort()).toEqual(declaradas.map((d) => d.src).sort());
  });
});
