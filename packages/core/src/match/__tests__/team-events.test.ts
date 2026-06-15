import { describe, it, expect } from 'vitest';
import {
  computeTeamEventTallies,
  foulsByPlayer,
  isFoulKind,
  isCornerSide,
  aggregateMatchTeamStats,
  type TeamEventLite,
  type MatchTeamStatEvent,
} from '../team-events';

describe('computeTeamEventTallies — faltas y córners por bando', () => {
  it('separa faltas propias/recibidas y córners a favor/en contra', () => {
    const events: TeamEventLite[] = [
      { type: 'foul', playerId: 'A', foulKind: 'committed' },
      { type: 'foul', playerId: 'B', foulKind: 'committed' },
      { type: 'foul', playerId: 'C', foulKind: 'received' },
      { type: 'corner', cornerSide: 'for' },
      { type: 'corner', cornerSide: 'against' },
      { type: 'corner', cornerSide: 'against' },
      { type: 'shot' }, // se ignora
      { type: 'offside' }, // se ignora
    ];
    expect(computeTeamEventTallies(events)).toEqual({
      foulsCommitted: 2,
      foulsReceived: 1,
      cornersFor: 1,
      cornersAgainst: 2,
    });
  });

  it('compat 7.4: foul sin foul_kind → cometida; corner sin corner_side → a favor', () => {
    const events: TeamEventLite[] = [
      { type: 'foul', playerId: 'A' },
      { type: 'corner' },
    ];
    expect(computeTeamEventTallies(events)).toEqual({
      foulsCommitted: 1,
      foulsReceived: 0,
      cornersFor: 1,
      cornersAgainst: 0,
    });
  });

  it('sin eventos → todo a 0', () => {
    expect(computeTeamEventTallies([])).toEqual({
      foulsCommitted: 0,
      foulsReceived: 0,
      cornersFor: 0,
      cornersAgainst: 0,
    });
  });
});

describe('foulsByPlayer — atribución de faltas cometidas', () => {
  it('cuenta las cometidas por jugador; ignora las recibidas', () => {
    const events: TeamEventLite[] = [
      { type: 'foul', playerId: 'A', foulKind: 'committed' },
      { type: 'foul', playerId: 'A', foulKind: 'committed' },
      { type: 'foul', playerId: 'B', foulKind: 'committed' },
      { type: 'foul', playerId: 'C', foulKind: 'received' }, // recibida → no se atribuye
      { type: 'corner', cornerSide: 'for' }, // no es falta
    ];
    const m = foulsByPlayer(events);
    expect(m.get('A')).toBe(2);
    expect(m.get('B')).toBe(1);
    expect(m.has('C')).toBe(false);
  });

  it('un foul legacy sin foul_kind se atribuye como cometida', () => {
    const m = foulsByPlayer([{ type: 'foul', playerId: 'A' }]);
    expect(m.get('A')).toBe(1);
  });
});

describe('guards de metadata', () => {
  it('isFoulKind / isCornerSide', () => {
    expect(isFoulKind('committed')).toBe(true);
    expect(isFoulKind('received')).toBe(true);
    expect(isFoulKind('foo')).toBe(false);
    expect(isCornerSide('for')).toBe(true);
    expect(isCornerSide('against')).toBe(true);
    expect(isCornerSide('left')).toBe(false);
  });
});

describe('aggregateMatchTeamStats — agregados de equipo del partido (F7.x X.0)', () => {
  it('deriva for/against por tipo según el modelo real', () => {
    const events: MatchTeamStatEvent[] = [
      // Córners: siempre side='own', for/against por metadata.
      { side: 'own', type: 'corner', cornerSide: 'for' },
      { side: 'own', type: 'corner', cornerSide: 'for' },
      { side: 'own', type: 'corner', cornerSide: 'against' },
      // Faltas: siempre side='own', committed/received por metadata.
      { side: 'own', type: 'foul', foulKind: 'committed' },
      { side: 'own', type: 'foul', foulKind: 'received' },
      { side: 'own', type: 'foul', foulKind: 'received' },
      // Tiros: por side.
      { side: 'own', type: 'shot' },
      { side: 'own', type: 'shot' },
      { side: 'rival', type: 'shot' },
      // Tarjetas: por side.
      { side: 'own', type: 'yellow_card' },
      { side: 'rival', type: 'yellow_card' },
      { side: 'rival', type: 'red_card' },
      // Offsides: por side.
      { side: 'own', type: 'offside' },
      { side: 'rival', type: 'offside' },
      { side: 'rival', type: 'offside' },
      // Ruido que NO entra en estos agregados.
      { side: 'own', type: 'goal' },
      { side: 'own', type: 'assist' },
      { side: 'own', type: 'substitution' },
      { side: 'own', type: 'penalty' },
    ];
    expect(aggregateMatchTeamStats(events)).toEqual({
      corners: { own: 2, rival: 1 },
      fouls: { own: 1, rival: 2 }, // own = cometidas; rival = recibidas (las comete el rival)
      shots: { own: 2, rival: 1 },
      yellowCards: { own: 1, rival: 1 },
      redCards: { own: 0, rival: 1 },
      offsides: { own: 1, rival: 2 },
    });
  });

  it('reusa los defaults de compat de computeTeamEventTallies (córner/falta legacy sin metadata)', () => {
    const events: MatchTeamStatEvent[] = [
      { side: 'own', type: 'foul' }, // sin foul_kind → cometida (own)
      { side: 'own', type: 'corner' }, // sin corner_side → a favor (own)
    ];
    const out = aggregateMatchTeamStats(events);
    expect(out.fouls).toEqual({ own: 1, rival: 0 });
    expect(out.corners).toEqual({ own: 1, rival: 0 });
  });

  it('ignora córner/falta con side="rival" (el modelo los captura siempre como own + metadata)', () => {
    // Defensivo: aunque no deberían existir, una fila rival de corner/foul no
    // debe contaminar los contadores de córner/falta.
    const events: MatchTeamStatEvent[] = [
      { side: 'rival', type: 'corner', cornerSide: 'against' },
      { side: 'rival', type: 'foul', foulKind: 'committed' },
    ];
    const out = aggregateMatchTeamStats(events);
    expect(out.corners).toEqual({ own: 0, rival: 0 });
    expect(out.fouls).toEqual({ own: 0, rival: 0 });
  });

  it('sin eventos → todos los pares a 0', () => {
    expect(aggregateMatchTeamStats([])).toEqual({
      corners: { own: 0, rival: 0 },
      fouls: { own: 0, rival: 0 },
      shots: { own: 0, rival: 0 },
      yellowCards: { own: 0, rival: 0 },
      redCards: { own: 0, rival: 0 },
      offsides: { own: 0, rival: 0 },
    });
  });
});
