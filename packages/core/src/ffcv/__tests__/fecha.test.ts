import { describe, expect, it } from 'vitest';
import { aIsoUtc, partirFecha, partirHora } from '../fecha';

/**
 * Las fechas y horas de aquí son las REALES del calendario del Infantil B, leído el
 * 2026-10-12. Eso es lo que hace útil al test: la temporada CRUZA los dos cambios de hora
 * —el de octubre de 2026 (día 25) y el de marzo de 2027 (día 28)—, así que un
 * desplazamiento fijo se vería aquí y en ningún otro sitio.
 */
describe('aIsoUtc · la hora local de la FFCV a un instante UTC', () => {
  it('jornada 1, 18/10/2026 10:30 → verano (UTC+2)', () => {
    expect(aIsoUtc('18/10/2026', '10:30')).toBe('2026-10-18T08:30:00.000Z');
  });

  it('EL CASO DEL CAMBIO DE OCTUBRE: las jornadas 2 y 3 son las dos a las 16:00 locales y NO son la misma hora UTC', () => {
    // J2 el 24-10-2026, el día ANTES del cambio. J3 el 31-10, después.
    const j2 = aIsoUtc('24/10/2026', '16:00');
    const j3 = aIsoUtc('31/10/2026', '16:00');
    expect(j2).toBe('2026-10-24T14:00:00.000Z');
    expect(j3).toBe('2026-10-31T15:00:00.000Z');
    // Si alguien sustituye esto por un offset fijo, los dos saldrían iguales en UTC.
    expect(j2?.slice(11, 16)).not.toBe(j3?.slice(11, 16));
  });

  it('EL CASO DEL CAMBIO DE MARZO: la jornada 19 (13/03/2027) es invierno y la 20 (03/04/2027) ya es verano', () => {
    expect(aIsoUtc('13/03/2027', '16:00')).toBe('2027-03-13T15:00:00.000Z');
    expect(aIsoUtc('03/04/2027', '13:30')).toBe('2027-04-03T11:30:00.000Z');
  });

  it('la última jornada, 16/05/2027 09:00 → verano', () => {
    expect(aIsoUtc('16/05/2027', '09:00')).toBe('2027-05-16T07:00:00.000Z');
  });

  it('acepta los guiones de `fecha_jornada` además de las barras de `fecha`', () => {
    expect(aIsoUtc('18-10-2026', '10:30')).toBe(aIsoUtc('18/10/2026', '10:30'));
  });

  it('devuelve null en vez de inventarse una hora', () => {
    expect(aIsoUtc('', '')).toBeNull();
    expect(aIsoUtc('18/10/2026', '')).toBeNull();
    expect(aIsoUtc('2026-10-18', '10:30')).toBeNull();
    expect(aIsoUtc('32/10/2026', '10:30')).toBeNull();
    expect(aIsoUtc('18/13/2026', '10:30')).toBeNull();
    expect(aIsoUtc('18/10/2026', '25:00')).toBeNull();
  });
});

describe('los dos partidores', () => {
  it('parten lo que la FFCV manda', () => {
    expect(partirFecha('18/10/2026')).toEqual({ dia: 18, mes: 10, anio: 2026 });
    expect(partirFecha('18-10-2026')).toEqual({ dia: 18, mes: 10, anio: 2026 });
    expect(partirHora('16:00')).toEqual({ h: 16, m: 0 });
    expect(partirHora('9:00')).toEqual({ h: 9, m: 0 });
  });
});
