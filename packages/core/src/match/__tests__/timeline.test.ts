import { describe, it, expect } from 'vitest';
import {
  periodAtClock,
  clockFieldsForMinute,
  sortTimeline,
  findTimelineIssues,
  type TimelineEventLite,
} from '../timeline';
import type { ClockPeriod } from '../clock';
import { computeScore, type ScoreEvent } from '../score';
import { computeTeamEventTallies, type TeamEventLite } from '../team-events';
import { computePlayingSeconds, type MatchEventLite } from '../playing-time';
import { deriveExpelledPlayers } from '../event';

// Reloj de ejemplo: 1ª parte [0, 2700], 2ª parte base 2700 [2700, 5400].
const PERIODS: ClockPeriod[] = [
  {
    period: 'first_half',
    ordinal: 1,
    baseOffsetSeconds: 0,
    accumulatedSeconds: 2700,
    running: false,
    lastStartedAt: null,
    ended: true,
  },
  {
    period: 'second_half',
    ordinal: 2,
    baseOffsetSeconds: 2700,
    accumulatedSeconds: 2700,
    running: false,
    lastStartedAt: null,
    ended: true,
  },
];

describe('periodAtClock — periodo que contiene un instante absoluto', () => {
  it('asigna el periodo por el mayor baseOffset que no supera el instante', () => {
    expect(periodAtClock(PERIODS, 0)).toBe('first_half');
    expect(periodAtClock(PERIODS, 600)).toBe('first_half');
    expect(periodAtClock(PERIODS, 2699)).toBe('first_half');
    expect(periodAtClock(PERIODS, 2700)).toBe('second_half');
    expect(periodAtClock(PERIODS, 3000)).toBe('second_half');
    // Más allá del último periodo → sigue siendo el último.
    expect(periodAtClock(PERIODS, 9999)).toBe('second_half');
  });

  it('sin periodos → null; independiente del orden del array', () => {
    expect(periodAtClock([], 100)).toBeNull();
    const reversed = [...PERIODS].reverse();
    expect(periodAtClock(reversed, 3000)).toBe('second_half');
  });
});

describe('clockFieldsForMinute — reanclar a un minuto (inversa de displayMinute)', () => {
  it('minuto → clock_seconds=minuto*60, periodo coherente y display_minute', () => {
    expect(clockFieldsForMinute(PERIODS, 10)).toEqual({
      clockSeconds: 600,
      period: 'first_half',
      displayMinute: 10,
    });
    // Minuto 50 cae en la 2ª parte (base 2700 = min 45).
    expect(clockFieldsForMinute(PERIODS, 50)).toEqual({
      clockSeconds: 3000,
      period: 'second_half',
      displayMinute: 50,
    });
  });

  it('redondea hacia abajo y nunca baja de 0', () => {
    expect(clockFieldsForMinute(PERIODS, -5).clockSeconds).toBe(0);
    expect(clockFieldsForMinute(PERIODS, 12.9).clockSeconds).toBe(720);
  });

  it('sin periodos → first_half por defecto', () => {
    expect(clockFieldsForMinute([], 10).period).toBe('first_half');
  });
});

describe('sortTimeline — orden cronológico estable', () => {
  it('ordena por clock_seconds asc y desempata por created_at', () => {
    const rows = [
      { id: 'c', clockSeconds: 3000, createdAt: '2026-01-01T00:00:02Z' },
      { id: 'a', clockSeconds: 600, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', clockSeconds: 600, createdAt: '2026-01-01T00:00:01Z' },
    ];
    expect(sortTimeline(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('cambiar el minuto (reescribir clock_seconds) reubica el evento al reordenar', () => {
    const before = [
      { id: 'gol', clockSeconds: 600 },
      { id: 'tarjeta', clockSeconds: 1800 },
    ];
    expect(sortTimeline(before).map((r) => r.id)).toEqual(['gol', 'tarjeta']);
    // El gol se reancla al minuto 40 (2400s): pasa a ir DESPUÉS de la tarjeta.
    const after = before.map((r) =>
      r.id === 'gol' ? { ...r, clockSeconds: clockFieldsForMinute(PERIODS, 40).clockSeconds } : r,
    );
    expect(sortTimeline(after).map((r) => r.id)).toEqual(['tarjeta', 'gol']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rederivación tras editar la línea: minutos, marcador, contadores, expulsiones
// se recalculan SOLO de los eventos resultantes (no hay estado paralelo).
// ─────────────────────────────────────────────────────────────────────────────

describe('rederivación tras editar la línea de tiempo', () => {
  const P1 = 'p1';
  const P2 = 'p2';

  interface Row {
    id: string;
    side: 'own' | 'rival';
    type: string;
    playerId: string | null;
    relatedPlayerId: string | null;
    clockSeconds: number;
    outcome: string | null;
    foulKind: string | null;
    cornerSide: string | null;
  }

  // Estado base: P1 marca (min 10), P2 ve amarilla (min 20), córner a favor,
  // falta cometida por P1, gol del rival.
  const base = (): Row[] => [
    { id: 'g1', side: 'own', type: 'goal', playerId: P1, relatedPlayerId: null, clockSeconds: 600, outcome: null, foulKind: null, cornerSide: null },
    { id: 'y1', side: 'own', type: 'yellow_card', playerId: P2, relatedPlayerId: null, clockSeconds: 1200, outcome: null, foulKind: null, cornerSide: null },
    { id: 'c1', side: 'own', type: 'corner', playerId: null, relatedPlayerId: null, clockSeconds: 1300, outcome: null, foulKind: null, cornerSide: 'for' },
    { id: 'f1', side: 'own', type: 'foul', playerId: P1, relatedPlayerId: null, clockSeconds: 1400, outcome: null, foulKind: 'committed', cornerSide: null },
    { id: 'rg', side: 'rival', type: 'goal', playerId: null, relatedPlayerId: null, clockSeconds: 1500, outcome: null, foulKind: null, cornerSide: null },
  ];

  const asScore = (rows: Row[]): ScoreEvent[] =>
    rows.map((r) => ({ side: r.side, type: r.type, outcome: r.outcome }));
  const asTeam = (rows: Row[]): TeamEventLite[] =>
    rows.filter((r) => r.side === 'own').map((r) => ({ type: r.type, playerId: r.playerId, foulKind: r.foulKind, cornerSide: r.cornerSide }));
  const asPlaying = (rows: Row[]): MatchEventLite[] =>
    rows.filter((r) => r.side === 'own').map((r) => ({ type: r.type, playerId: r.playerId, relatedPlayerId: r.relatedPlayerId, clockSeconds: r.clockSeconds, outcome: r.outcome }));

  it('marcador y contadores del estado base', () => {
    const rows = base();
    expect(computeScore(asScore(rows))).toEqual({ own: 1, rival: 1 });
    expect(computeTeamEventTallies(asTeam(rows))).toMatchObject({ cornersFor: 1, foulsCommitted: 1 });
  });

  it('BORRAR el gol propio rederiva el marcador (1-1 → 0-1)', () => {
    const rows = base().filter((r) => r.id !== 'g1');
    expect(computeScore(asScore(rows))).toEqual({ own: 0, rival: 1 });
  });

  it('AÑADIR un penalti marcado rederiva el marcador (1-1 → 2-1)', () => {
    const rows = [
      ...base(),
      { id: 'pk', side: 'own', type: 'penalty', playerId: P2, relatedPlayerId: null, clockSeconds: 2000, outcome: 'scored', foulKind: null, cornerSide: null } as Row,
    ];
    expect(computeScore(asScore(rows))).toEqual({ own: 2, rival: 1 });
  });

  it('EDITAR el bando del córner (a favor → en contra) rederiva los contadores', () => {
    const rows = base().map((r) => (r.id === 'c1' ? { ...r, cornerSide: 'against' } : r));
    const tallies = computeTeamEventTallies(asTeam(rows));
    expect(tallies.cornersFor).toBe(0);
    expect(tallies.cornersAgainst).toBe(1);
  });

  it('AÑADIR una 2ª amarilla a P2 lo deja EXPULSADO (estado derivado)', () => {
    const rows = [
      ...base(),
      { id: 'y2', side: 'own', type: 'yellow_card', playerId: P2, relatedPlayerId: null, clockSeconds: 1800, outcome: null, foulKind: null, cornerSide: null } as Row,
    ];
    const expelled = deriveExpelledPlayers(rows.filter((r) => r.side === 'own').map((r) => ({ type: r.type, playerId: r.playerId })));
    expect(expelled.has(P2)).toBe(true);
  });

  it('una roja a un titular RECORTA sus minutos al rederivar', () => {
    const rowsSin = base();
    const sin = computePlayingSeconds({ starterIds: [P1], events: asPlaying(rowsSin), matchClockSeconds: 5400 });
    expect(sin.get(P1)).toBe(5400); // titular el partido entero

    const rowsCon = [
      ...base(),
      { id: 'r1', side: 'own', type: 'red_card', playerId: P1, relatedPlayerId: null, clockSeconds: 3000, outcome: null, foulKind: null, cornerSide: null } as Row,
    ];
    const con = computePlayingSeconds({ starterIds: [P1], events: asPlaying(rowsCon), matchClockSeconds: 5400 });
    expect(con.get(P1)).toBe(3000); // sale en su roja (min 50)
  });
});

describe('findTimelineIssues — estados imposibles (avisar, no romper)', () => {
  const ev = (over: Partial<TimelineEventLite>): TimelineEventLite => ({
    id: 'x',
    side: 'own',
    type: 'goal',
    playerId: null,
    relatedPlayerId: null,
    clockSeconds: 600,
    ...over,
  });

  it('un ausente con evento propio → absent_has_event', () => {
    const issues = findTimelineIssues([ev({ id: 'e1', playerId: 'absent1' })], { absentIds: ['absent1'] });
    expect(issues).toEqual([{ code: 'absent_has_event', eventId: 'e1', playerId: 'absent1' }]);
  });

  it('evento DESPUÉS de la expulsión → event_after_expulsion (la roja en sí no)', () => {
    const events: TimelineEventLite[] = [
      ev({ id: 'red', type: 'red_card', playerId: 'p1', clockSeconds: 1000 }),
      ev({ id: 'late', type: 'goal', playerId: 'p1', clockSeconds: 2000 }),
    ];
    const issues = findTimelineIssues(events, { absentIds: [] });
    expect(issues).toEqual([{ code: 'event_after_expulsion', eventId: 'late', playerId: 'p1' }]);
  });

  it('expulsión por DOBLE amarilla cierra a partir de la 2ª', () => {
    const events: TimelineEventLite[] = [
      ev({ id: 'y1', type: 'yellow_card', playerId: 'p1', clockSeconds: 600 }),
      ev({ id: 'y2', type: 'yellow_card', playerId: 'p1', clockSeconds: 1200 }),
      ev({ id: 'after', type: 'assist', playerId: 'p1', clockSeconds: 1300 }),
    ];
    const codes = findTimelineIssues(events, { absentIds: [] }).map((i) => i.eventId);
    expect(codes).toEqual(['after']);
  });

  it('sustitución que mete a un ausente → sub_in_absent', () => {
    const events: TimelineEventLite[] = [
      ev({ id: 'sub', type: 'substitution', playerId: 'out1', relatedPlayerId: 'absent1', clockSeconds: 1500 }),
    ];
    const issues = findTimelineIssues(events, { absentIds: ['absent1'] });
    expect(issues.some((i) => i.code === 'sub_in_absent' && i.playerId === 'absent1')).toBe(true);
  });

  it('línea coherente → sin avisos', () => {
    const events: TimelineEventLite[] = [
      ev({ id: 'g', type: 'goal', playerId: 'p1', clockSeconds: 600 }),
      ev({ id: 'sub', type: 'substitution', playerId: 'p1', relatedPlayerId: 'p2', clockSeconds: 1500 }),
    ];
    expect(findTimelineIssues(events, { absentIds: [] })).toEqual([]);
  });
});
