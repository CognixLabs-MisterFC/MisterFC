import { describe, expect, it } from 'vitest';
import {
  blankFormationPositions,
  positionsFromFormation,
  clampPct,
  placeOnFormation,
  coachFormationToFormation,
  positionKeyOfSlotCode,
} from '../coach-formations';
import { isPositionKey } from '../positions';
import { defaultFormation, formationsForFormat } from '../formations';

describe('positionsFromFormation / blankFormationPositions', () => {
  it('mapea los slots del catálogo a claves canónicas (no códigos crudos)', () => {
    const f = defaultFormation('F8');
    const pos = positionsFromFormation(f);
    expect(pos).toHaveLength(f.slots.length);
    // El primer slot del catálogo es el portero → clave canónica GK.
    expect(pos[0]!.position_code).toBe('GK');
    expect(pos[0]!.x_pct).toBe(f.slots[0]!.xPct);
    // Todas las posiciones usan claves canónicas (BUG 1).
    expect(pos.every((p) => isPositionKey(p.position_code))).toBe(true);
  });

  it('blank trae el nº de posiciones de la modalidad', () => {
    expect(blankFormationPositions('F7')).toHaveLength(7);
    expect(blankFormationPositions('F8')).toHaveLength(8);
    expect(blankFormationPositions('F11')).toHaveLength(11);
  });
});

describe('clampPct', () => {
  it('acota a [0,100]', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(33.333)).toBe(33.33);
  });
});

describe('placeOnFormation (adoptar layout)', () => {
  const positions = formationsForFormat('F7')[0]!.slots.map((s) => ({
    position_code: s.code,
    x_pct: s.xPct,
    y_pct: s.yPct,
  })); // 7 posiciones

  it('coloca primero a los del campo, luego rellena desde el banquillo', () => {
    const field = ['p1', 'p2', 'p3'];
    const bench = ['p4', 'p5', 'p6', 'p7', 'p8'];
    const { placed, benched } = placeOnFormation(field, bench, positions);

    expect(placed).toHaveLength(7);
    // El orden de colocación es field ++ bench, truncado a 7.
    expect(placed.map((p) => p.playerId)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
    ]);
    // El que no cabe va al banquillo.
    expect(benched).toEqual(['p8']);
    // Cada colocado adopta el slot por índice.
    expect(placed[0]!.position).toEqual(positions[0]);
  });

  it('con menos jugadores que slots no inventa posiciones', () => {
    const { placed, benched } = placeOnFormation(['a', 'b'], [], positions);
    expect(placed).toHaveLength(2);
    expect(benched).toEqual([]);
  });
});

describe('coachFormationToFormation (render del layout custom, BUG 3)', () => {
  const cf = {
    id: '781d2f96-9cb6-4ec7-9735-8f8800da4584',
    name: 'JV',
    format: 'F8' as const,
    positions: [
      { position_code: 'GK', x_pct: 50, y_pct: 94 },
      { position_code: 'LB', x_pct: 20, y_pct: 74 },
      { position_code: 'CB', x_pct: 40, y_pct: 74 },
      { position_code: 'CB', x_pct: 60, y_pct: 74 },
      { position_code: 'RB', x_pct: 80, y_pct: 74 },
      { position_code: 'CM', x_pct: 35, y_pct: 50 },
      { position_code: 'CM', x_pct: 65, y_pct: 50 },
      { position_code: 'ST', x_pct: 50, y_pct: 24 },
    ],
  };

  it('sintetiza un Formation con las x/y reales y códigos de slot únicos', () => {
    const f = coachFormationToFormation(cf);
    expect(f.code).toBe(cf.id);
    expect(f.format).toBe('F8');
    expect(f.slots).toHaveLength(8);
    // x/y reales del layout del entrenador.
    expect(f.slots[0]).toMatchObject({ xPct: 50, yPct: 94, role: 'GK' });
    // Códigos de slot ÚNICOS aunque la clave se repita (dos CB).
    const codes = f.slots.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('CB_1');
    expect(codes).toContain('CB_2');
  });

  it('positionKeyOfSlotCode recupera la clave de posición del código de slot', () => {
    expect(positionKeyOfSlotCode('CB_2')).toBe('CB');
    expect(positionKeyOfSlotCode('GK_1')).toBe('GK');
    expect(positionKeyOfSlotCode('GK')).toBe('GK');
  });
});
