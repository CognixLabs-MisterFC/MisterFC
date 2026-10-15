import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWebManifest } from '../manifest';

/**
 * Cada icono que declara el manifiesto de la PWA tiene que existir en `public/` con el
 * tamaño que dice. Hasta octubre de 2026 no existía ninguno (`public/icons/README.md`
 * los daba por «placeholders» de la Fase 13) y Android instalaba la PWA sin icono.
 * La lista sale del manifiesto que se sirve, no de una copia a mano.
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

const PUBLIC = join(repoRoot(), 'apps/web/public');

/** Ancho y alto de un PNG, de su cabecera IHDR. */
function tamanoPng(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('iconos del manifiesto de la PWA', () => {
  // Encendida y apagada: los iconos son los mismos.
  const iconos = [
    ...buildWebManifest({ MARKETING_SITE: 'off' }).icons,
    ...buildWebManifest({ MARKETING_SITE: 'on' }).icons,
  ];

  it('premisa: el manifiesto declara iconos', () => {
    expect(iconos.length).toBeGreaterThanOrEqual(2);
  });

  it.each(iconos.map((i) => [i.src, i.sizes] as const))('%s existe y mide %s', (src, sizes) => {
    const f = join(PUBLIC, src);
    expect(existsSync(f)).toBe(true);
    const [w, h] = tamanoPng(readFileSync(f));
    expect(`${w}x${h}`).toBe(sizes);
  });
});
