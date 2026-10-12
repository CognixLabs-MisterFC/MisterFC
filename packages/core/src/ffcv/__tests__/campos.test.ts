import { describe, expect, it } from 'vitest';
import {
  componerDireccion,
  descargarCatalogoCampos,
  direccionEnCatalogo,
  leerDatosCampo,
} from '../campos';
import type { CampoCrudo, FfcvFetch } from '../types';

/** Campos REALES del catálogo y de la ficha, leídos el 2026-10-12. */
const QUATRE_CARRERES: CampoCrudo = {
  nombre_campo: 'Polideportivo Mpal. Quatre Carreres F-11',
  direccion: 'Carrer d`Angel de Villena, s/n',
  localidad: 'Valencia',
  provincia: 'Valencia',
  codigo_postal: '46013',
};
const NAZARET: CampoCrudo = {
  codigo: '5174',
  nombre: 'Polideportivo Mpal. de Nazaret F-11',
  direccion: 'Carrer Fernando Morais de la Horra',
  localidad: 'Valencia',
  provincia: 'Valencia',
  codigo_postal: '46024',
};
const BONREPOS: CampoCrudo = {
  codigo: '6001',
  nombre: 'Campo Mpal. El Barranc F-11 Bonrepos',
  direccion: 'Carrer Baixada de Carpesa',
  localidad: 'Bonrepòs I Mirambell',
  provincia: 'Valencia',
  codigo_postal: '46131',
};

function fingir(paginas: unknown[]): FfcvFetch {
  let i = 0;
  return async () => {
    const body = paginas[Math.min(i, paginas.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
const CFG = { token: 'a'.repeat(64), esperar: async () => {}, intentos: 2 };

describe('componerDireccion', () => {
  it('no repite la provincia cuando es igual que la localidad', () => {
    expect(componerDireccion(QUATRE_CARRERES)).toBe(
      'Carrer d`Angel de Villena, s/n, 46013 Valencia',
    );
  });

  it('añade la provincia cuando aporta algo', () => {
    expect(componerDireccion(BONREPOS)).toBe(
      'Carrer Baixada de Carpesa, 46131 Bonrepòs I Mirambell (Valencia)',
    );
  });

  it('devuelve null si no hay ni calle ni localidad', () => {
    expect(componerDireccion({ nombre: 'x' })).toBeNull();
  });

  it('cabe en location_address (240)', () => {
    const d = componerDireccion(QUATRE_CARRERES);
    expect(d && d.length).toBeLessThanOrEqual(240);
  });
});

describe('descargarCatalogoCampos', () => {
  it('recorre las páginas y casa por nombre EXACTO', async () => {
    const fetchImpl = fingir([
      { estado: '1', total_paginas: '2', total_registros: '3', campos: [NAZARET] },
      { estado: '1', total_paginas: '2', total_registros: '3', campos: [BONREPOS] },
    ]);
    const r = await descargarCatalogoCampos({ ...CFG, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.size).toBe(2);
    expect(direccionEnCatalogo('Polideportivo Mpal. de Nazaret F-11', r.datos)).toEqual({
      nombre: 'Polideportivo Mpal. de Nazaret F-11',
      direccion: 'Carrer Fernando Morais de la Horra, 46024 Valencia',
    });
  });

  it('un campo que no está en el catálogo da null, no una dirección de otro', async () => {
    const fetchImpl = fingir([
      { estado: '1', total_paginas: '1', campos: [NAZARET, BONREPOS] },
    ]);
    const r = await descargarCatalogoCampos({ ...CFG, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Medido: este campo del calendario NO está en el catálogo. Tampoco el nuestro.
    expect(direccionEnCatalogo('Campo La Malvarrosa F-11', r.datos)).toBeNull();
    expect(direccionEnCatalogo('Polideportivo Mpal. Quatre Carreres F-11', r.datos)).toBeNull();
  });

  it('si una página se degrada, devuelve fallo y NO un catálogo a medias', async () => {
    let i = 0;
    const fetchImpl: FfcvFetch = async () => {
      i += 1;
      const body =
        i === 1
          ? { estado: '1', total_paginas: '2', campos: [NAZARET] }
          : { campos: [], _source: 'degraded_empty', _upstream: { code: 503 } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await descargarCatalogoCampos({ ...CFG, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('degradado');
  });
});

describe('leerDatosCampo · la vía del campo PROPIO, que no está en el catálogo', () => {
  it('lo resuelve por su código', async () => {
    const fetchImpl = fingir([{ estado: '1', ...QUATRE_CARRERES }]);
    const r = await leerDatosCampo('5338', { ...CFG, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toEqual({
      nombre: 'Polideportivo Mpal. Quatre Carreres F-11',
      direccion: 'Carrer d`Angel de Villena, s/n, 46013 Valencia',
    });
  });
});
