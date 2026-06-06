import { describe, it, expect } from 'vitest';
import {
  computeTeamEventTallies,
  foulsByPlayer,
  isFoulKind,
  isCornerSide,
  type TeamEventLite,
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
