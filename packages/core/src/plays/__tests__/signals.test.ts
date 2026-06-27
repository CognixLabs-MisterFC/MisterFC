import { describe, it, expect } from 'vitest';
import {
  STRATEGY_TYPES,
  PLAY_SIGNAL_IDS,
  PLAY_SIGNAL_CATALOG,
  isStrategyType,
  isPlaySignalId,
  getPlaySignal,
} from '../signals';

describe('strategy types', () => {
  it('son los 4 esperados', () => {
    expect([...STRATEGY_TYPES]).toEqual(['corner', 'falta', 'saque_banda', 'saque_centro']);
  });
  it('isStrategyType valida', () => {
    expect(isStrategyType('corner')).toBe(true);
    expect(isStrategyType('penalti')).toBe(false);
    expect(isStrategyType(null)).toBe(false);
  });
});

describe('catálogo de señas', () => {
  it('tiene exactamente 10 señas y coincide con PLAY_SIGNAL_IDS en orden', () => {
    expect(PLAY_SIGNAL_CATALOG).toHaveLength(10);
    expect(PLAY_SIGNAL_IDS).toHaveLength(10);
    expect(PLAY_SIGNAL_CATALOG.map((s) => s.id)).toEqual([...PLAY_SIGNAL_IDS]);
  });

  it('ids únicos', () => {
    expect(new Set(PLAY_SIGNAL_CATALOG.map((s) => s.id)).size).toBe(10);
  });

  it('cada seña tiene labelKey y formas dibujables (base + gesto)', () => {
    for (const sgn of PLAY_SIGNAL_CATALOG) {
      expect(sgn.labelKey).toBeTruthy();
      // base = cabeza + tronco + 2 piernas (4) + al menos 1 forma de gesto.
      expect(sgn.shapes.length).toBeGreaterThanOrEqual(5);
      for (const sh of sgn.shapes) {
        expect(['line', 'circle', 'path']).toContain(sh.t);
      }
    }
  });

  it('isPlaySignalId y getPlaySignal', () => {
    expect(isPlaySignalId('puno_alto')).toBe(true);
    expect(isPlaySignalId('saludo')).toBe(false);
    expect(getPlaySignal('mano_cadera')?.id).toBe('mano_cadera');
    expect(getPlaySignal('nope')).toBeUndefined();
  });
});
