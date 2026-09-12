import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SU-7 — CENSO de los enlaces legales en los DOS muros.
 *
 * Apple no lo pide como consejo: su documentación de suscripciones dice que «your app
 * and App Store metadata must include links to your Terms of Use and Privacy Policy», y
 * una suscripción auto-renovable sin esos dos enlaces en el binario es un rechazo por
 * Guideline 3.1.2. No es un detalle de copy: es el permiso para cobrar.
 *
 * Se censan los dos muros por el mismo motivo que SU-5 censó los dos layouts: el segundo
 * es el que se olvida. Y se comprueba leyendo los ficheros porque ninguno de los dos se
 * puede renderizar en este runner — el de la nativa necesita React Native y el de la web
 * es un componente de servidor.
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

const MUROS = [
  { nombre: 'nativa', ruta: 'apps/native/src/subscription/paywall.tsx' },
  { nombre: 'web', ruta: 'apps/web/src/app/[locale]/suscripcion/page.tsx' },
] as const;

describe.each(MUROS)('el muro de $nombre lleva los dos enlaces legales', ({ ruta }) => {
  const src = readFileSync(join(ROOT, ruta), 'utf8');

  it('enlaza las condiciones de uso', () => {
    expect(src).toMatch(/terms_link/);
    expect(src).toMatch(/legal\/terminos|'terminos'/);
  });

  it('enlaza la política de privacidad', () => {
    expect(src).toMatch(/privacy_link/);
    expect(src).toMatch(/legal\/privacidad|'privacidad'/);
  });

  /**
   * Y el aviso de renovación sigue ahí: el precio y la periodicidad los pone la tienda,
   * pero «se renueva automáticamente» y «cómo cancelar» los tenemos que decir nosotros
   * (Schedule 2 del acuerdo de desarrollador).
   */
  it('mantiene el aviso de renovación automática', () => {
    expect(src).toMatch(/terms_note/);
  });
});

/**
 * La otra mitad de lo que exige la tienda en la pantalla de compra: precio completo bien
 * visible, periodicidad, y una forma de RESTAURAR para quien ya pagó. El precio sale de
 * la tienda (`priceString`), no de un literal nuestro: un precio escrito a mano sería
 * falso en cuanto cambie el país o la divisa.
 */
describe('el muro de la nativa cumple el resto de la pantalla de compra', () => {
  const src = readFileSync(join(ROOT, 'apps/native/src/subscription/paywall.tsx'), 'utf8');

  it('el precio viene de la tienda, no de un literal', () => {
    expect(src).toMatch(/pkg\.product\.priceString/);
    expect(src).not.toMatch(/3\s?€/);
  });

  it('dice la periodicidad', () => {
    expect(src).toMatch(/per_year/);
  });

  it('ofrece restaurar compras', () => {
    expect(src).toMatch(/restorePurchases|t\('restore'\)/);
  });
});
