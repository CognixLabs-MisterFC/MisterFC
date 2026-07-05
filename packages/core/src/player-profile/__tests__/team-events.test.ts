import { describe, expect, it } from 'vitest';
import {
  aggregateTeamEventsByType,
  type TeamEventRow,
} from '../team-events';

function ev(
  side: 'own' | 'rival',
  kind: string,
  eventType: string,
  tournamentId: string | null = null,
): TeamEventRow {
  return { side, kind, eventType, tournamentId };
}

describe('aggregateTeamEventsByType (F9B-4b)', () => {
  it('own: clasifica por tipo (torneo vs oficial) y suma en total', () => {
    const a = aggregateTeamEventsByType([
      ev('own', 'corner', 'match', null), // oficial
      ev('own', 'corner', 'match', 'tour-1'), // torneo
      ev('own', 'corner', 'friendly', null), // amistoso
    ]);
    expect(a.own.oficial.corner).toBe(1);
    expect(a.own.torneo.corner).toBe(1);
    expect(a.own.amistoso.corner).toBe(1);
    expect(a.own.total.corner).toBe(3);
    // torneo NO cae en oficial
    expect(a.own.oficial.corner).not.toBe(2);
  });

  it('rival: solo total, no toca el desglose own', () => {
    const a = aggregateTeamEventsByType([
      ev('rival', 'corner', 'match', null),
      ev('rival', 'shot', 'match', null),
      ev('own', 'corner', 'match', null),
    ]);
    expect(a.rivalTotal.corner).toBe(1);
    expect(a.rivalTotal.shot).toBe(1);
    expect(a.own.total.corner).toBe(1); // el corner rival no suma en own
    expect(a.own.total.shot ?? 0).toBe(0);
  });

  it('total own = suma de los tres grupos, por tipo de evento', () => {
    const a = aggregateTeamEventsByType([
      ev('own', 'foul', 'match', null),
      ev('own', 'foul', 'match', null),
      ev('own', 'offside', 'friendly', null),
      ev('own', 'foul', 'match', 'tour-1'),
    ]);
    expect(a.own.oficial.foul).toBe(2);
    expect(a.own.torneo.foul).toBe(1);
    expect(a.own.total.foul).toBe(3);
    expect(a.own.amistoso.offside).toBe(1);
    expect(a.own.total.offside).toBe(1);
  });

  it("ignora partidos no clasificables ('other'/'training')", () => {
    const a = aggregateTeamEventsByType([
      ev('own', 'corner', 'other', null),
      ev('own', 'corner', 'training', null),
      ev('rival', 'shot', 'other', null),
    ]);
    expect(a.own.total.corner ?? 0).toBe(0);
    expect(a.rivalTotal.shot ?? 0).toBe(0);
  });

  it('claves ausentes = 0 (mapa vacío en grupos sin eventos)', () => {
    const a = aggregateTeamEventsByType([]);
    expect(a.own.total.corner ?? 0).toBe(0);
    expect(a.rivalTotal.foul ?? 0).toBe(0);
    expect(a.own.oficial).toEqual({});
  });
});
