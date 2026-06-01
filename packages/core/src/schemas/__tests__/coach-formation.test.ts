import { describe, expect, it } from 'vitest';
import {
  createCoachFormationSchema,
  updateCoachFormationSchema,
  deleteCoachFormationSchema,
  coachFormationPositionSchema,
} from '../coach-formation';
import { blankFormationPositions } from '../../lineups/coach-formations';

const UUID = '11111111-1111-4111-8111-111111111111';

// Posiciones válidas para una modalidad (parte del preset por defecto).
const f8Positions = blankFormationPositions('F8'); // 8 items
const f7Positions = blankFormationPositions('F7'); // 7 items
const f11Positions = blankFormationPositions('F11'); // 11 items

describe('coachFormationPositionSchema', () => {
  it('acepta un hueco válido', () => {
    const r = coachFormationPositionSchema.safeParse({
      position_code: 'GK',
      x_pct: 50,
      y_pct: 94,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza position_code vacío', () => {
    const r = coachFormationPositionSchema.safeParse({
      position_code: '',
      x_pct: 50,
      y_pct: 50,
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('position_code_required');
  });

  it('rechaza coordenadas fuera de [0,100]', () => {
    const r = coachFormationPositionSchema.safeParse({
      position_code: 'DF1',
      x_pct: 120,
      y_pct: 50,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('coord_out_of_range');
  });
});

describe('createCoachFormationSchema (nº de posiciones por modalidad)', () => {
  it('F7 acepta 7 posiciones', () => {
    const r = createCoachFormationSchema.safeParse({
      name: 'Mi 1-3-3',
      format: 'F7',
      positions: f7Positions,
    });
    expect(r.success).toBe(true);
  });

  it('F8 acepta 8 posiciones', () => {
    const r = createCoachFormationSchema.safeParse({
      name: 'Mi 1-3-3-1',
      format: 'F8',
      positions: f8Positions,
    });
    expect(r.success).toBe(true);
  });

  it('F11 acepta 11 posiciones', () => {
    const r = createCoachFormationSchema.safeParse({
      name: 'Mi 4-4-2',
      format: 'F11',
      positions: f11Positions,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza nº de posiciones que no cuadra con la modalidad', () => {
    const r = createCoachFormationSchema.safeParse({
      name: 'Incompleta',
      format: 'F8',
      positions: f7Positions, // 7 ≠ 8
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('positions_count_mismatch');
      expect(r.error.issues[0]?.path).toEqual(['positions']);
    }
  });

  it('rechaza nombre vacío', () => {
    const r = createCoachFormationSchema.safeParse({
      name: '   ',
      format: 'F8',
      positions: f8Positions,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('name_required');
  });

  it('rechaza modalidad inválida', () => {
    const r = createCoachFormationSchema.safeParse({
      name: 'X',
      format: 'F5',
      positions: f8Positions,
    });
    expect(r.success).toBe(false);
  });
});

describe('updateCoachFormationSchema', () => {
  it('exige id uuid', () => {
    const r = updateCoachFormationSchema.safeParse({
      id: 'no-uuid',
      name: 'X',
      format: 'F8',
      positions: f8Positions,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('id_invalid');
  });

  it('acepta update válido', () => {
    const r = updateCoachFormationSchema.safeParse({
      id: UUID,
      name: 'Renombrada',
      format: 'F8',
      positions: f8Positions,
    });
    expect(r.success).toBe(true);
  });
});

describe('deleteCoachFormationSchema', () => {
  it('exige id uuid', () => {
    expect(deleteCoachFormationSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(deleteCoachFormationSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
