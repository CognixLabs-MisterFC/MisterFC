import { describe, it, expect } from 'vitest';
import {
  sumMatchStats,
  emptyAggregatedStats,
  type MatchStatRow,
} from '../aggregate';

function row(over: Partial<MatchStatRow> = {}): MatchStatRow {
  return {
    started: false,
    minutes_played: 0,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    shots: 0,
    fouls_committed: 0,
    fouls_received: 0,
    penalties_scored: 0,
    penalties_missed: 0,
    ...over,
  };
}

describe('sumMatchStats', () => {
  it('devuelve todo a cero para una temporada sin partidos', () => {
    expect(sumMatchStats([])).toEqual(emptyAggregatedStats());
  });

  it('cuenta partidos (filas) y titularidades por separado', () => {
    const agg = sumMatchStats([
      row({ started: true }),
      row({ started: false }),
      row({ started: true }),
    ]);
    expect(agg.matches).toBe(3);
    expect(agg.starts).toBe(2);
  });

  it('suma cada columna de stats', () => {
    const agg = sumMatchStats([
      row({
        started: true,
        minutes_played: 90,
        goals: 2,
        assists: 1,
        yellow_cards: 1,
        red_cards: 0,
        shots: 4,
        fouls_committed: 2,
        fouls_received: 3,
        penalties_scored: 1,
        penalties_missed: 0,
      }),
      row({
        started: false,
        minutes_played: 25,
        goals: 0,
        assists: 2,
        yellow_cards: 0,
        red_cards: 1,
        shots: 1,
        fouls_committed: 1,
        fouls_received: 0,
        penalties_scored: 0,
        penalties_missed: 1,
      }),
    ]);
    expect(agg).toEqual({
      matches: 2,
      starts: 1,
      minutesPlayed: 115,
      goals: 2,
      assists: 3,
      yellowCards: 1,
      redCards: 1,
      shots: 5,
      foulsCommitted: 3,
      foulsReceived: 3,
      penaltiesScored: 1,
      penaltiesMissed: 1,
    });
  });

  it('es independiente del orden de las filas', () => {
    const a = row({ minutes_played: 10, goals: 1 });
    const b = row({ minutes_played: 80, goals: 3, started: true });
    expect(sumMatchStats([a, b])).toEqual(sumMatchStats([b, a]));
  });

  it('no muta las filas de entrada', () => {
    const r = row({ goals: 2 });
    sumMatchStats([r]);
    expect(r.goals).toBe(2);
  });
});
