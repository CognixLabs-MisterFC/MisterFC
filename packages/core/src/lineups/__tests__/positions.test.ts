import { describe, expect, it } from 'vitest';
import {
  POSITION_KEYS,
  isPositionKey,
  roleFromPositionKey,
  normalizePositionCode,
} from '../positions';

describe('normalizePositionCode (BUG 1 — clave neutra canónica)', () => {
  it('mapea las etiquetas ES legacy del editor a su clave', () => {
    const cases: [string, string][] = [
      ['POR', 'GK'],
      ['LD', 'RB'],
      ['DFC', 'CB'],
      ['LI', 'LB'],
      ['MCD', 'DM'],
      ['MC', 'CM'],
      ['MD', 'RM'],
      ['MI', 'LM'],
      ['MP', 'AM'],
      ['ED', 'RW'],
      ['EI', 'LW'],
      ['DC', 'ST'],
    ];
    for (const [es, key] of cases) {
      expect(normalizePositionCode(es)).toBe(key);
    }
  });

  it('deja intactas las claves canónicas', () => {
    for (const k of POSITION_KEYS) expect(normalizePositionCode(k)).toBe(k);
  });

  it('mapea códigos de slot del catálogo (rol+índice) por rol', () => {
    expect(normalizePositionCode('GK')).toBe('GK');
    expect(normalizePositionCode('DF1')).toBe('CB');
    expect(normalizePositionCode('MF2')).toBe('CM');
    expect(normalizePositionCode('FW1')).toBe('ST');
  });

  it('devuelve null para un código irreconocible', () => {
    expect(normalizePositionCode('ZZZ')).toBeNull();
  });
});

describe('roleFromPositionKey', () => {
  it('agrupa las claves por rol genérico', () => {
    expect(roleFromPositionKey('GK')).toBe('GK');
    expect(roleFromPositionKey('LB')).toBe('DF');
    expect(roleFromPositionKey('CB')).toBe('DF');
    expect(roleFromPositionKey('DM')).toBe('MF');
    expect(roleFromPositionKey('AM')).toBe('MF');
    expect(roleFromPositionKey('LW')).toBe('FW');
    expect(roleFromPositionKey('ST')).toBe('FW');
  });
});

describe('isPositionKey', () => {
  it('reconoce claves canónicas y rechaza etiquetas ES', () => {
    expect(isPositionKey('CB')).toBe(true);
    expect(isPositionKey('DFC')).toBe(false);
    expect(isPositionKey('')).toBe(false);
  });
});
