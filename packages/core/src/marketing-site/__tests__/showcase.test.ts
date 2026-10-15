import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { showcaseClubs, type ShowcaseClub } from '../index';

const conPermiso: ShowcaseClub = {
  nombre: 'CF Ejemplo',
  logo: '/web/clubes/ejemplo.png',
  permisoFirmado: '2026-11-02',
};
const sinPermiso: ShowcaseClub = { nombre: 'CF Sin Permiso', logo: '/x.png', permisoFirmado: '' };

describe('showcaseClubs — el apartado de clubes, oculto por defecto', () => {
  it('CONFIGURACIÓN POR DEFECTO (sin variable): no se pinta nada, aunque haya clubes con permiso', () => {
    expect(showcaseClubs({}, [conPermiso])).toEqual([]);
  });

  it('variable con otro valor que `on`: oculto', () => {
    for (const v of ['true', '1', 'ON ', 'yes']) {
      expect(showcaseClubs({ NEXT_PUBLIC_WEB_SHOWCASE: v }, [conPermiso])).toEqual([]);
    }
  });

  it('encendido pero lista vacía: oculto (ni título ni hueco)', () => {
    expect(showcaseClubs({ NEXT_PUBLIC_WEB_SHOWCASE: 'on' }, [])).toEqual([]);
  });

  it('encendido: solo los clubes con fecha de permiso', () => {
    expect(
      showcaseClubs({ NEXT_PUBLIC_WEB_SHOWCASE: 'on' }, [
        sinPermiso,
        conPermiso,
        { ...conPermiso, permisoFirmado: 'pendiente' },
      ]),
    ).toEqual([conPermiso]);
  });
});

/**
 * CENSO del cableado: la portada pinta el apartado SOLO a través de `showcaseClubs`, con
 * la lista de `lib/web/showcase.ts`. Si alguien pintara los clubes por otro camino, el
 * test de arriba seguiría verde y el apartado saldría sin permiso.
 */
describe('cableado del apartado de clubes', () => {
  const root = (() => {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
      dir = dirname(dir);
    }
    throw new Error('no encuentro la raíz del repo');
  })();
  const leer = (r: string) => readFileSync(join(root, r), 'utf8');

  it('el componente decide con showcaseClubs(process.env, SHOWCASE_CLUBS) y sin clubes no pinta nada', () => {
    const src = leer('apps/web/src/app/[locale]/(web)/_components/clubs-showcase.tsx');
    expect(src).toContain('showcaseClubs(process.env, SHOWCASE_CLUBS)');
    expect(src).toMatch(/if \(clubs\.length === 0\) return null;/);
  });

  it('la portada usa ese componente y no importa la lista de clubes directamente', () => {
    const src = leer('apps/web/src/app/[locale]/(web)/portada/page.tsx');
    expect(src).toContain('<ClubsShowcase />');
    expect(src).not.toContain('SHOWCASE_CLUBS');
  });

  it('la lista de clubes está VACÍA mientras no haya permisos firmados', () => {
    const src = leer('apps/web/src/lib/web/showcase.ts');
    expect(src).toMatch(/export const SHOWCASE_CLUBS: readonly ShowcaseClub\[\] = \[\];/);
  });
});
