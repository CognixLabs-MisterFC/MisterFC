import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El icono de la pestaña. Hasta octubre de 2026, `app/favicon.ico` era el de
 * create-next-app (el triángulo de Vercel), que llegó con el andamiaje de la Fase 0 y
 * nunca se cambió. Ahora salen del icono de la app nativa: `favicon.ico` (16, 32 y 48),
 * `icon.png` y `apple-icon.png`, en la raíz de `app/` para que valgan en todas las rutas.
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

const APP = join(repoRoot(), 'apps/web/src/app');
/** sha256 del favicon de create-next-app que hubo hasta octubre de 2026. */
const FAVICON_DE_NEXT = '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932';

/** Tamaños de las imágenes de un .ico (cabecera ICONDIR; 0 significa 256). */
function tamanosIco(buf: Buffer): number[] {
  const n = buf.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => buf[6 + i * 16] || 256).sort((a, b) => a - b);
}

describe('iconos de misterfc.es', () => {
  const ico = readFileSync(join(APP, 'favicon.ico'));

  it('favicon.ico no es el de create-next-app (el triángulo de Vercel)', () => {
    expect(createHash('sha256').update(ico).digest('hex')).not.toBe(FAVICON_DE_NEXT);
  });

  it('favicon.ico lleva 16, 32 y 48', () => {
    expect(ico.readUInt16LE(2)).toBe(1); // tipo 1 = icono
    expect(tamanosIco(ico)).toEqual([16, 32, 48]);
  });

  it.each(['icon.png', 'apple-icon.png'])('%s existe y es un PNG', (f) => {
    const png = readFileSync(join(APP, f));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
