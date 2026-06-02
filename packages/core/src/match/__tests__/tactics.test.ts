import { describe, it, expect } from 'vitest';
import {
  assignPlayersToFormation,
  clampPct,
  moveLivePlayer,
  type FieldPlayerPos,
} from '../tactics';
import { getFormation } from '../../lineups/formations';

describe('clampPct', () => {
  it('acota a [0,100] y redondea a 2 decimales', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(33.3333)).toBe(33.33);
    expect(clampPct(Number.NaN)).toBe(0);
  });
});

describe('moveLivePlayer', () => {
  it('actualiza x/y (acotado) y conserva positionCode', () => {
    const start = { P1: { positionCode: 'CB', xPct: 30, yPct: 70 } };
    const next = moveLivePlayer(start, 'P1', 120, 44.555);
    expect(next.P1).toEqual({ positionCode: 'CB', xPct: 100, yPct: 44.56 });
    // No muta la entrada.
    expect(start.P1.xPct).toBe(30);
  });

  it('crea la posición si el jugador no tenía override (positionCode null)', () => {
    const next = moveLivePlayer({}, 'P9', 50, 20);
    expect(next.P9).toEqual({ positionCode: null, xPct: 50, yPct: 20 });
  });
});

describe('assignPlayersToFormation', () => {
  // 11 jugadores ordenados de atrás (GK) a delante.
  const eleven: FieldPlayerPos[] = [
    { playerId: 'GK', xPct: 50, yPct: 94 },
    { playerId: 'D1', xPct: 20, yPct: 76 },
    { playerId: 'D2', xPct: 40, yPct: 76 },
    { playerId: 'D3', xPct: 60, yPct: 76 },
    { playerId: 'D4', xPct: 80, yPct: 76 },
    { playerId: 'M1', xPct: 20, yPct: 50 },
    { playerId: 'M2', xPct: 40, yPct: 50 },
    { playerId: 'M3', xPct: 60, yPct: 50 },
    { playerId: 'M4', xPct: 80, yPct: 50 },
    { playerId: 'F1', xPct: 40, yPct: 24 },
    { playerId: 'F2', xPct: 60, yPct: 24 },
  ];

  it('reparte los 11 en los slots de la nueva formación (4-4-2 → 4-3-3)', () => {
    const f433 = getFormation('4-3-3');
    expect(f433).toBeDefined();
    const out = assignPlayersToFormation(eleven, f433!);
    // Todos colocados, sin slots de sobra ni de menos.
    expect(Object.keys(out)).toHaveLength(11);
    // El portero (yPct más alto) cae en el slot GK.
    expect(out.GK?.positionCode).toBe('GK');
    // Cada jugador queda en las coords de algún slot de la formación destino.
    const slotCoords = new Set(f433!.slots.map((s) => `${s.xPct},${s.yPct}`));
    for (const pos of Object.values(out)) {
      expect(slotCoords.has(`${pos.xPct},${pos.yPct}`)).toBe(true);
    }
    // Sin posiciones duplicadas (biyección con los slots).
    const used = Object.values(out).map((p) => `${p.xPct},${p.yPct}`);
    expect(new Set(used).size).toBe(11);
  });

  it('con menos jugadores que slots (uno expulsado), llena solo los necesarios', () => {
    const ten = eleven.slice(0, 10); // quitamos F2
    const f433 = getFormation('4-3-3')!;
    const out = assignPlayersToFormation(ten, f433);
    expect(Object.keys(out)).toHaveLength(10);
    // El portero sigue en portería; queda un slot de la formación sin ocupar.
    expect(out.GK?.positionCode).toBe('GK');
    const usedSlots = new Set(Object.values(out).map((p) => p.positionCode));
    expect(usedSlots.size).toBe(10);
  });

  it('respeta el orden izquierda→derecha dentro de cada línea', () => {
    const f442 = getFormation('4-4-2')!;
    const out = assignPlayersToFormation(eleven, f442);
    // D1 (x=20) es el defensa más a la izquierda → menor xPct entre los DF.
    const defenders = f442.slots.filter((s) => s.role === 'DF').sort((a, b) => a.xPct - b.xPct);
    expect(out.D1?.xPct).toBe(defenders[0]!.xPct);
    expect(out.D4?.xPct).toBe(defenders[defenders.length - 1]!.xPct);
  });
});
