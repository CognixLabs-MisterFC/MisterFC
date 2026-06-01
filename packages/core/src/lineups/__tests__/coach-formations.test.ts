import { describe, expect, it } from 'vitest';
import {
  blankFormationPositions,
  positionsFromFormation,
  clampPct,
  placeOnFormation,
} from '../coach-formations';
import { defaultFormation, formationsForFormat } from '../formations';

describe('positionsFromFormation / blankFormationPositions', () => {
  it('mapea los slots del catálogo a {position_code, x_pct, y_pct}', () => {
    const f = defaultFormation('F8');
    const pos = positionsFromFormation(f);
    expect(pos).toHaveLength(f.slots.length);
    expect(pos[0]).toEqual({
      position_code: f.slots[0]!.code,
      x_pct: f.slots[0]!.xPct,
      y_pct: f.slots[0]!.yPct,
    });
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
