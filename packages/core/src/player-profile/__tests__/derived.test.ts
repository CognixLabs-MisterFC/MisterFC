import { describe, it, expect } from 'vitest';
import { derivedRatios, attendanceBreakdown } from '../derived';
import { emptyAggregatedStats, type AggregatedStats } from '../aggregate';

function stats(over: Partial<AggregatedStats> = {}): AggregatedStats {
  return { ...emptyAggregatedStats(), ...over };
}

describe('derivedRatios', () => {
  it('todo null con 0 partidos (sin dividir por cero)', () => {
    const r = derivedRatios(stats({ matches: 0 }));
    expect(r).toEqual({
      goalsPerMatch: null,
      goalsPer90: null,
      assistsPerMatch: null,
      minutesPerMatch: null,
      startRate: null,
      cardsPerMatch: null,
      foulsCommittedPerMatch: null,
      foulsReceivedPerMatch: null,
    });
  });

  it('calcula ratios por partido y por 90', () => {
    const r = derivedRatios(
      stats({
        matches: 4,
        starts: 3,
        minutesPlayed: 360,
        goals: 6,
        assists: 2,
        yellowCards: 2,
        redCards: 0,
        foulsCommitted: 8,
        foulsReceived: 4,
      })
    );
    expect(r.goalsPerMatch).toBe(1.5);
    expect(r.goalsPer90).toBe((6 * 90) / 360); // 1.5
    expect(r.assistsPerMatch).toBe(0.5);
    expect(r.minutesPerMatch).toBe(90);
    expect(r.startRate).toBe(0.75);
    expect(r.cardsPerMatch).toBe(0.5);
    expect(r.foulsCommittedPerMatch).toBe(2);
    expect(r.foulsReceivedPerMatch).toBe(1);
  });

  it('goalsPer90 es null si no hay minutos aunque haya partidos', () => {
    const r = derivedRatios(stats({ matches: 2, minutesPlayed: 0, goals: 1 }));
    expect(r.goalsPer90).toBeNull();
    expect(r.goalsPerMatch).toBe(0.5);
  });

  it('cuenta amarillas + rojas como tarjetas', () => {
    const r = derivedRatios(stats({ matches: 2, yellowCards: 3, redCards: 1 }));
    expect(r.cardsPerMatch).toBe(2);
  });
});

describe('attendanceBreakdown', () => {
  it('total 0 → presentPct null y todos los códigos a 0', () => {
    const b = attendanceBreakdown([]);
    expect(b.total).toBe(0);
    expect(b.presentPct).toBeNull();
    expect(b.perBucket).toEqual({
      present: 0,
      justified: 0,
      unjustified: 0,
      partial: 0,
    });
    // todos los códigos presentes en el desglose, inicializados a 0
    expect(b.perCode.presente).toBe(0);
    expect(b.perCode.descanso).toBe(0);
  });

  it('clasifica por bucket de ADR-0007 y cuenta por código', () => {
    const b = attendanceBreakdown([
      { code: 'presente' },
      { code: 'presente' },
      { code: 'ausente' }, // unjustified
      { code: 'lesionado' }, // justified
      { code: 'enfermo' }, // justified
      { code: 'entreno_diferenciado' }, // partial
    ]);
    expect(b.total).toBe(6);
    expect(b.perCode.presente).toBe(2);
    expect(b.perCode.ausente).toBe(1);
    expect(b.perBucket).toEqual({
      present: 2,
      justified: 2,
      unjustified: 1,
      partial: 1,
    });
    expect(b.presentPct).toBeCloseTo(2 / 6, 10);
  });

  it('no muta las filas de entrada', () => {
    const rows = [{ code: 'presente' as const }];
    attendanceBreakdown(rows);
    expect(rows).toEqual([{ code: 'presente' }]);
  });
});
