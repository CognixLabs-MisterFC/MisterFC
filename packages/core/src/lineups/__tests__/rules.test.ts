import { describe, expect, it } from 'vitest';
import {
  MODALITY_RULES,
  calledUpOverflow,
  maxCalledUpFor,
  modalityRules,
  startersFor,
} from '../rules';
import { fieldCapacity } from '../geometry';
import { getFormation } from '../formations';

describe('reglas por modalidad', () => {
  it('starters coincide con el nº de slots del preset de esa modalidad', () => {
    expect(startersFor('F7')).toBe(fieldCapacity(getFormation('1-3-3')!)); // 7
    expect(startersFor('F8')).toBe(fieldCapacity(getFormation('1-3-3-1')!)); // 8
    expect(startersFor('F11')).toBe(fieldCapacity(getFormation('4-3-3')!)); // 11
  });

  it('starters + maxBench = maxCalledUp en cada modalidad', () => {
    for (const fmt of ['F7', 'F8', 'F11'] as const) {
      const r = modalityRules(fmt);
      expect(r.starters + r.maxBench).toBe(r.maxCalledUp);
    }
  });

  it('valores esperados', () => {
    expect(MODALITY_RULES.F7).toEqual({ starters: 7, maxCalledUp: 12, maxBench: 5 });
    expect(MODALITY_RULES.F8).toEqual({ starters: 8, maxCalledUp: 14, maxBench: 6 });
    expect(MODALITY_RULES.F11).toEqual({ starters: 11, maxCalledUp: 18, maxBench: 7 });
  });

  it('calledUpOverflow devuelve el sobrante o 0', () => {
    expect(calledUpOverflow(12, 'F7')).toBe(0);
    expect(calledUpOverflow(13, 'F7')).toBe(1);
    expect(calledUpOverflow(16, 'F8')).toBe(2);
    expect(calledUpOverflow(10, 'F11')).toBe(0);
    expect(maxCalledUpFor('F8')).toBe(14);
  });
});
