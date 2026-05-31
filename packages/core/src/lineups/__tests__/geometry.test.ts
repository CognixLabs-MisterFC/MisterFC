import { describe, expect, it } from 'vitest';
import { getFormation } from '../formations';
import {
  fieldCapacity,
  remapToFormation,
  roleFromPosition,
  type FieldPlayerInput,
} from '../geometry';

describe('roleFromPosition', () => {
  it('mapea las posiciones de ficha a roles de slot', () => {
    expect(roleFromPosition('goalkeeper')).toBe('GK');
    expect(roleFromPosition('defender')).toBe('DF');
    expect(roleFromPosition('midfielder')).toBe('MF');
    expect(roleFromPosition('forward')).toBe('FW');
    expect(roleFromPosition(null)).toBeNull();
    expect(roleFromPosition(undefined)).toBeNull();
  });
});

describe('remapToFormation', () => {
  const f433 = getFormation('4-3-3')!; // 1 GK, 4 DF, 3 MF, 3 FW
  const f442 = getFormation('4-4-2')!; // 1 GK, 4 DF, 4 MF, 2 FW

  function players(spec: Array<[string, FieldPlayerInput['role']]>): FieldPlayerInput[] {
    return spec.map(([playerId, role]) => ({ playerId, role }));
  }

  it('conserva el rol de cada jugador cuando hay slot libre del mismo rol', () => {
    const input = players([
      ['gk', 'GK'],
      ['d1', 'DF'],
      ['m1', 'MF'],
      ['f1', 'FW'],
    ]);
    const { assignments, benched } = remapToFormation(input, f433);
    expect(benched).toEqual([]);
    const byPlayer = Object.fromEntries(
      assignments.map((a) => [a.playerId, a.positionCode]),
    );
    expect(byPlayer.gk).toMatch(/^GK/);
    expect(byPlayer.d1).toMatch(/^DF/);
    expect(byPlayer.m1).toMatch(/^MF/);
    expect(byPlayer.f1).toMatch(/^FW/);
  });

  it('asigna coordenadas tomadas del slot de la nueva formación', () => {
    const { assignments } = remapToFormation(players([['gk', 'GK']]), f433);
    const a0 = assignments[0]!;
    const gkSlot = f433.slots.find((s) => s.code === a0.positionCode)!;
    expect(a0.xPct).toBe(gkSlot.xPct);
    expect(a0.yPct).toBe(gkSlot.yPct);
  });

  it('manda al banquillo a los jugadores que exceden la capacidad del campo', () => {
    // 12 jugadores para una formación de 11 slots → 1 al banquillo.
    const input = players(
      Array.from({ length: 12 }, (_, i) => [`p${i}`, 'MF'] as [string, 'MF']),
    );
    const { assignments, benched } = remapToFormation(input, f433);
    expect(assignments).toHaveLength(11);
    expect(benched).toHaveLength(1);
  });

  it('un jugador sin rol ocupa cualquier slot libre (pasada 2)', () => {
    const input: FieldPlayerInput[] = [
      { playerId: 'gk', role: 'GK' },
      { playerId: 'sinrol' },
    ];
    const { assignments, benched } = remapToFormation(input, f433);
    expect(benched).toEqual([]);
    expect(assignments.map((a) => a.playerId).sort()).toEqual(['gk', 'sinrol']);
  });

  it('cuando el rol se agota, el sobrante cae en un slot libre de otro rol', () => {
    // 4-3-3 solo tiene 3 slots MF; el 4º MF debe ir a un slot libre, no al banquillo.
    const input = players([
      ['m1', 'MF'],
      ['m2', 'MF'],
      ['m3', 'MF'],
      ['m4', 'MF'],
    ]);
    const { assignments, benched } = remapToFormation(input, f433);
    expect(benched).toEqual([]);
    expect(assignments).toHaveLength(4);
  });

  it('es estable: mismo input → mismo resultado', () => {
    const input = players([
      ['a', 'DF'],
      ['b', 'DF'],
      ['c', 'MF'],
    ]);
    const r1 = remapToFormation(input, f442);
    const r2 = remapToFormation(input, f442);
    expect(r1).toEqual(r2);
  });

  it('no asigna el mismo slot a dos jugadores', () => {
    const input = players(
      Array.from({ length: 11 }, (_, i) => [`p${i}`, 'DF'] as [string, 'DF']),
    );
    const { assignments } = remapToFormation(input, f433);
    const codes = assignments.map((a) => a.positionCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('fieldCapacity', () => {
  it('es el nº de slots del preset', () => {
    expect(fieldCapacity(getFormation('1-3-3')!)).toBe(7);
    expect(fieldCapacity(getFormation('4-3-3')!)).toBe(11);
  });
});
