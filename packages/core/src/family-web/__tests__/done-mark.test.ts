import { describe, expect, it } from 'vitest';
import { familyWebCutDoneMark, FAMILY_WEB_CUT_DONE_MARKS } from '../cut';

/**
 * `/aplicacion` es la pantalla TERMINAL del corte: es donde acaba el alta por
 * invitación y, desde este PR, el cambio de contraseña. Quien llega después de
 * hacer algo viene a saber si funcionó, así que la página lee del query param qué
 * fue — y el query param lo compone cualquiera.
 *
 * Por eso la lista es cerrada y la comparación exacta: en la pantalla donde una
 * familia confirma que su cuenta existe, dejar que una URL decida el texto sería un
 * sitio especialmente malo para ser flexible.
 */
describe('familyWebCutDoneMark', () => {
  it('reconoce la marca del cambio de contraseña', () => {
    expect(familyWebCutDoneMark('contrasena')).toBe('contrasena');
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vacío', ''],
    ['desconocido', 'cualquier-cosa'],
    ['con otra caja', 'Contrasena'],
    ['con espacios', ' contrasena '],
    ['parecido', 'contrasena2'],
  ])('descarta el valor %s', (_caso, raw) => {
    expect(familyWebCutDoneMark(raw as string | undefined)).toBeNull();
  });

  // Next entrega los parámetros repetidos como array. Quedarse con el primero es
  // más honesto que rechazar la petición entera por una URL rara.
  it('de un parámetro repetido se queda con el primero', () => {
    expect(familyWebCutDoneMark(['contrasena', 'otra'])).toBe('contrasena');
    expect(familyWebCutDoneMark(['otra', 'contrasena'])).toBeNull();
  });

  it('un array vacío no es una marca', () => {
    expect(familyWebCutDoneMark([])).toBeNull();
  });

  // Control del propio test: si alguien añade una marca a la lista, este test se
  // entera y obliga a mirar si la pantalla sabe pintarla.
  it('la lista de marcas es la que la pantalla sabe pintar', () => {
    expect([...FAMILY_WEB_CUT_DONE_MARKS]).toEqual(['contrasena']);
  });
});
