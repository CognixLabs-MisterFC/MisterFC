import { describe, expect, it } from 'vitest';
import { FORMATIONS, defaultFormation, formationsForFormat, getFormation } from '../formations';
import { TEAM_FORMATS, type TeamFormat } from '../types';

/** Nº esperado de jugadores de campo por modalidad (sin contar al portero). */
const OUTFIELD: Record<TeamFormat, number> = { F5: 4, F7: 6, F8: 7, F11: 10 };

describe('catálogo de formaciones', () => {
  it('cada formación tiene exactamente un portero', () => {
    for (const f of FORMATIONS) {
      const gks = f.slots.filter((s) => s.role === 'GK');
      expect(gks, f.code).toHaveLength(1);
    }
  });

  it('el nº de slots coincide con la modalidad (GK + jugadores de campo)', () => {
    for (const f of FORMATIONS) {
      const expected = OUTFIELD[f.format] + 1;
      expect(f.slots.length, f.code).toBe(expected);
    }
  });

  it('el código de la formación refleja el reparto por filas (suma = jugadores de campo)', () => {
    for (const f of FORMATIONS) {
      const fromCode = f.code
        .split('-')
        .filter((n) => /^\d+$/.test(n))
        .map(Number)
        .reduce((a, b) => a + b, 0);
      // El primer '1' del código F5/F7/F8 es el portero; F11 no lo lleva.
      const outfield = f.format === 'F11' ? fromCode : fromCode - 1;
      expect(outfield, f.code).toBe(OUTFIELD[f.format]);
    }
  });

  it('todas las coordenadas están dentro de 0–100', () => {
    for (const f of FORMATIONS) {
      for (const s of f.slots) {
        expect(s.xPct, `${f.code}/${s.code}.x`).toBeGreaterThanOrEqual(0);
        expect(s.xPct).toBeLessThanOrEqual(100);
        expect(s.yPct, `${f.code}/${s.code}.y`).toBeGreaterThanOrEqual(0);
        expect(s.yPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('los códigos de slot son únicos dentro de cada formación', () => {
    for (const f of FORMATIONS) {
      const codes = f.slots.map((s) => s.code);
      expect(new Set(codes).size, f.code).toBe(codes.length);
    }
  });

  it('los códigos de formación son únicos en el catálogo', () => {
    const codes = FORMATIONS.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('getFormation devuelve por código y undefined si no existe', () => {
    expect(getFormation('4-3-3')?.format).toBe('F11');
    expect(getFormation('no-existe')).toBeUndefined();
  });

  /**
   * Recorre TEAM_FORMATS y no una lista escrita aquí: así una modalidad nueva
   * entra en este test sola. Es la única red contra el agujero que el tipo NO
   * puede tapar — un formato en la lista sin formaciones en el catálogo hace que
   * `defaultFormation` LANCE en caliente, al abrir /alineacion, y el typecheck no
   * dice nada. Medido el 2026-10-13 al añadir el F5.
   */
  it('cada modalidad de TEAM_FORMATS tiene catálogo, y la primera es la de por defecto', () => {
    for (const fmt of TEAM_FORMATS) {
      const list = formationsForFormat(fmt);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((f) => f.format === fmt)).toBe(true);
      expect(defaultFormation(fmt)).toBe(list[0]);
    }
  });

  it('F5: las tres de Jose, y la 1-2-2 es la de por defecto', () => {
    // Decisión de producto (2026-10-13), no un detalle de implementación: el orden
    // del catálogo ES la elección de la formación por defecto.
    expect(formationsForFormat('F5').map((f) => f.code)).toEqual(['1-2-2', '1-1-2-1', '1-3-1']);
    expect(defaultFormation('F5').code).toBe('1-2-2');
    // Cuatro de campo más portero, en las tres.
    for (const f of formationsForFormat('F5')) {
      expect(f.slots, f.code).toHaveLength(5);
    }
  });

  it('el portero está centrado y en su propio campo (y alto)', () => {
    for (const f of FORMATIONS) {
      const gk = f.slots.find((s) => s.role === 'GK')!;
      expect(gk.xPct).toBe(50);
      expect(gk.yPct).toBeGreaterThan(80);
    }
  });
});
