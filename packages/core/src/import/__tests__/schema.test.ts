import { describe, it, expect } from 'vitest';
import { playerImportRowSchema, normalizeDate } from '../schema';

/**
 * 9 escenarios de validación según spec §7. Cada test mapea a un caso
 * mencionado explícitamente en el plan.
 */
describe('playerImportRowSchema — validación por fila', () => {
  const base = {
    first_name: 'Pepe',
    last_name: 'Gomez',
    date_of_birth: '2010-05-15',
  };

  it('acepta fecha YYYY-MM-DD', () => {
    const r = playerImportRowSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-05-15');
  });

  it('normaliza fecha DD/MM/YYYY a ISO', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '15/05/2010' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-05-15');
  });

  it('normaliza fecha DD-MM-YYYY a ISO', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '15-05-2010' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-05-15');
  });

  it('falla sin date_of_birth con código date_of_birth_required', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('date_of_birth_required');
  });

  it('falla con dorsal fuera de rango (0, 100, -1, abc)', () => {
    for (const bad of [0, 100, -1, 'abc']) {
      const r = playerImportRowSchema.safeParse({ ...base, dorsal: bad });
      expect(r.success, `dorsal=${bad}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe('dorsal_invalid');
    }
  });

  it('position_main acepta espacios y mayúsculas via trim+lowercase', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: ' MIDFIELDER ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.position_main).toBe('midfielder');
  });

  it('position_main rechaza valor desconocido (striker)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: 'striker' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('position_invalid');
  });

  it('positions_secondary split por | y rechaza valor inválido', () => {
    const ok = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: 'defender|midfielder',
    });
    expect(ok.success).toBe(true);
    if (ok.success)
      expect(ok.data.positions_secondary).toEqual(['defender', 'midfielder']);

    const bad = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: 'defender|striker',
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('position_invalid');
  });

  it('weight_kg acepta coma y punto decimal, ambos a 72.5', () => {
    const comma = playerImportRowSchema.safeParse({ ...base, weight_kg: '72,5' });
    const dot = playerImportRowSchema.safeParse({ ...base, weight_kg: '72.5' });
    expect(comma.success).toBe(true);
    expect(dot.success).toBe(true);
    if (comma.success) expect(comma.data.weight_kg).toBe(72.5);
    if (dot.success) expect(dot.data.weight_kg).toBe(72.5);
  });

  it('height_cm fuera de rango falla con height_cm_invalid', () => {
    for (const bad of [49, 251, 'no-num']) {
      const r = playerImportRowSchema.safeParse({ ...base, height_cm: bad });
      expect(r.success, `height=${bad}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe('height_cm_invalid');
    }
  });
});

describe('normalizeDate', () => {
  it('devuelve null para vacío/null/undefined', () => {
    expect(normalizeDate('')).toBe(null);
    expect(normalizeDate(null)).toBe(null);
    expect(normalizeDate(undefined)).toBe(null);
  });
});
