import { describe, it, expect } from 'vitest';
import {
  consolidateMatch,
  type ConsolidationEvent,
} from '../consolidation';
import { computePlayingSeconds, countPlayerEvents, type MatchEventLite } from '../playing-time';
import { computeScore, type ScoreEvent } from '../score';
import { foulsByPlayer, foulsReceivedByPlayer, type TeamEventLite } from '../team-events';

const P1 = 'p1';
const P2 = 'p2';
const P3 = 'p3';

// Partido: P1 (titular) marca de penalti (min 10) y comete una falta; P2 (titular)
// recibe una falta y ve amarilla; P3 entra por P2 (min 60, 3600s) y falla un
// penalti; rival marca un gol.
function baseEvents(): ConsolidationEvent[] {
  return [
    { side: 'own', type: 'penalty', playerId: P1, clockSeconds: 600, outcome: 'scored' },
    { side: 'own', type: 'foul', playerId: P1, clockSeconds: 700, foulKind: 'committed' },
    { side: 'own', type: 'foul', playerId: P2, clockSeconds: 800, foulKind: 'received' },
    { side: 'own', type: 'yellow_card', playerId: P2, clockSeconds: 900 },
    { side: 'own', type: 'substitution', playerId: P2, relatedPlayerId: P3, clockSeconds: 3600 },
    { side: 'own', type: 'penalty', playerId: P3, clockSeconds: 4000, outcome: 'saved' },
    { side: 'rival', type: 'goal', clockSeconds: 2000 },
  ];
}

const CLOCK = 5400; // 90'
const STARTERS = [P1, P2];
const ROSTER = [P1, P2, P3];

describe('consolidateMatch — materialización = valores de los motores (no recalcula)', () => {
  it('minutos coinciden con computePlayingSeconds', () => {
    const events = baseEvents();
    const ownPlaying: MatchEventLite[] = events
      .filter((e) => e.side === 'own')
      .map((e) => ({
        type: e.type,
        playerId: e.playerId ?? null,
        relatedPlayerId: e.relatedPlayerId ?? null,
        clockSeconds: e.clockSeconds,
        outcome: e.outcome ?? null,
      }));
    const seconds = computePlayingSeconds({ starterIds: STARTERS, events: ownPlaying, matchClockSeconds: CLOCK });
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    for (const row of c.players) {
      expect(row.minutesPlayed).toBe(Math.floor((seconds.get(row.playerId) ?? 0) / 60));
    }
    // P2 sale en el min 60; P3 entra y juega hasta el final.
    expect(c.players.find((r) => r.playerId === P2)!.minutesPlayed).toBe(60);
    expect(c.players.find((r) => r.playerId === P3)!.minutesPlayed).toBe(30);
  });

  it('goles/asistencias/tarjetas coinciden con countPlayerEvents (penalti marcado = gol)', () => {
    const events = baseEvents();
    const counts = countPlayerEvents(
      events.filter((e) => e.side === 'own').map((e) => ({ type: e.type, playerId: e.playerId ?? null, outcome: e.outcome ?? null })),
    );
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    const p1 = c.players.find((r) => r.playerId === P1)!;
    expect(p1.goals).toBe(counts.get(P1)!.goals); // 1 (penalti marcado)
    expect(p1.goals).toBe(1);
    expect(p1.penaltiesScored).toBe(1);
    const p2 = c.players.find((r) => r.playerId === P2)!;
    expect(p2.yellowCards).toBe(1);
  });

  it('faltas cometidas/recibidas coinciden con team-events; penaltis fallados', () => {
    const events = baseEvents();
    const teamLite: TeamEventLite[] = events
      .filter((e) => e.side === 'own')
      .map((e) => ({ type: e.type, playerId: e.playerId ?? null, foulKind: e.foulKind ?? null }));
    const committed = foulsByPlayer(teamLite);
    const received = foulsReceivedByPlayer(teamLite);
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    const p1 = c.players.find((r) => r.playerId === P1)!;
    expect(p1.foulsCommitted).toBe(committed.get(P1) ?? 0); // 1
    expect(p1.foulsCommitted).toBe(1);
    const p2 = c.players.find((r) => r.playerId === P2)!;
    expect(p2.foulsReceived).toBe(received.get(P2) ?? 0); // 1
    const p3 = c.players.find((r) => r.playerId === P3)!;
    expect(p3.penaltiesMissed).toBe(1); // penalti parado
    expect(p3.penaltiesScored).toBe(0);
  });

  it('started refleja match_starters; el suplente que entró no es titular', () => {
    const c = consolidateMatch({ starterIds: STARTERS, events: baseEvents(), matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.players.find((r) => r.playerId === P1)!.started).toBe(true);
    expect(c.players.find((r) => r.playerId === P3)!.started).toBe(false);
  });

  it('marcador final = computeScore (penalti marcado cuenta; la tanda no)', () => {
    const events = baseEvents();
    const scoreEvents: ScoreEvent[] = events.map((e) => ({ side: e.side, type: e.type, outcome: e.outcome ?? null }));
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.score).toEqual(computeScore(scoreEvents));
    expect(c.score).toEqual({ own: 1, rival: 1 });
  });

  it('una fila por rosterId, en ese orden', () => {
    const c = consolidateMatch({ starterIds: STARTERS, events: baseEvents(), matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.players.map((r) => r.playerId)).toEqual(ROSTER);
  });
});

describe('consolidateMatch — tanda de penaltis', () => {
  it('sin tanda → shootout null', () => {
    const c = consolidateMatch({ starterIds: STARTERS, events: baseEvents(), matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.shootout).toBeNull();
  });

  it('con tanda → marcador de tanda + líder; NO suma a goles del partido', () => {
    const events: ConsolidationEvent[] = [
      ...baseEvents(),
      { side: 'own', type: 'shootout_penalty', playerId: P1, clockSeconds: 5401, outcome: 'scored' },
      { side: 'rival', type: 'shootout_penalty', clockSeconds: 5402, outcome: 'missed' },
      { side: 'own', type: 'shootout_penalty', playerId: P3, clockSeconds: 5403, outcome: 'scored' },
    ];
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.shootout).toEqual({ own: 2, rival: 0, leader: 'own' });
    // El marcador del partido NO cambia por la tanda.
    expect(c.score).toEqual({ own: 1, rival: 1 });
    // La tanda no suma goles ni penaltis del partido al jugador.
    expect(c.players.find((r) => r.playerId === P1)!.goals).toBe(1);
  });
});

describe('consolidateMatch — tiros por jugador (F-bug captura)', () => {
  it('cuenta shots por jugador cuando el evento lleva player_id', () => {
    const events: ConsolidationEvent[] = [
      ...baseEvents(),
      { side: 'own', type: 'shot', playerId: P1, clockSeconds: 1200 },
      { side: 'own', type: 'shot', playerId: P1, clockSeconds: 1500 },
      { side: 'own', type: 'shot', playerId: P3, clockSeconds: 4200 },
    ];
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.players.find((r) => r.playerId === P1)!.shots).toBe(2);
    expect(c.players.find((r) => r.playerId === P3)!.shots).toBe(1);
    expect(c.players.find((r) => r.playerId === P2)!.shots).toBe(0);
  });

  it('un tiro SIN player_id no se atribuye a nadie (causa raíz del bug #1)', () => {
    const events: ConsolidationEvent[] = [
      ...baseEvents(),
      { side: 'own', type: 'shot', playerId: null, clockSeconds: 1200 },
    ];
    const c = consolidateMatch({ starterIds: STARTERS, events, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.players.reduce((s, r) => s + r.shots, 0)).toBe(0);
  });
});

describe('consolidateMatch — re-cierre tras editar (determinista, sobrescribe)', () => {
  it('mismos eventos → misma consolidación (idempotente)', () => {
    const a = consolidateMatch({ starterIds: STARTERS, events: baseEvents(), matchClockSeconds: CLOCK, rosterIds: ROSTER });
    const b = consolidateMatch({ starterIds: STARTERS, events: baseEvents(), matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(b).toEqual(a);
  });

  it('borrar el penalti marcado (edición 7.9) rederiva marcador y goles del jugador', () => {
    const edited = baseEvents().filter((e) => !(e.type === 'penalty' && e.playerId === P1));
    const c = consolidateMatch({ starterIds: STARTERS, events: edited, matchClockSeconds: CLOCK, rosterIds: ROSTER });
    expect(c.score).toEqual({ own: 0, rival: 1 });
    expect(c.players.find((r) => r.playerId === P1)!.goals).toBe(0);
    expect(c.players.find((r) => r.playerId === P1)!.penaltiesScored).toBe(0);
  });
});
