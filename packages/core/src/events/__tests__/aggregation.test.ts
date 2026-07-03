import { describe, expect, test } from 'vitest';
import {
  callupEventIdFor,
  lineupWritesCallup,
  nextTournamentRound,
  consolidateReminderTargets,
  filterPublishedByAnchor,
  groupCallupsByTournament,
  pickNextEvent,
  pickLastEventWithin,
  pickNextMatchWithoutCallup,
  pickLastTrainingWithoutAttendance,
} from '../aggregation';

const NOW = '2026-06-15T10:00:00.000Z';

// F13B (T-2) — convocatoria heredada por referencia.
describe('callupEventIdFor', () => {
  test('partido de torneo → id de la cabecera', () => {
    expect(
      callupEventIdFor({ id: 'match-1', tournament_id: 'cabecera-9' }),
    ).toBe('cabecera-9');
  });

  test('evento normal (sin tournament_id) → él mismo', () => {
    expect(callupEventIdFor({ id: 'ev-1', tournament_id: null })).toBe('ev-1');
  });
});

describe('lineupWritesCallup', () => {
  test('partido de torneo → NO escribe convocatoria (solo distribuye)', () => {
    expect(lineupWritesCallup({ tournament_id: 'cabecera-9' })).toBe(false);
  });

  test('evento normal → sí escribe convocatoria (clásico)', () => {
    expect(lineupWritesCallup({ tournament_id: null })).toBe(true);
  });
});

// F13B (T-4) — avance de eliminatoria: ronda del siguiente partido.
describe('nextTournamentRound', () => {
  test('una sola ronda (torneo recién creado) → 2', () => {
    expect(nextTournamentRound([1])).toBe(2);
  });

  test('varias rondas desordenadas → max + 1', () => {
    expect(nextTournamentRound([1, 3, 2])).toBe(4);
  });

  test('ignora rondas nulas/no finitas', () => {
    expect(nextTournamentRound([1, null, 2])).toBe(3);
    expect(nextTournamentRound([null])).toBe(1);
  });

  test('sin rondas → arranca en 1', () => {
    expect(nextTournamentRound([])).toBe(1);
  });
});

// F13B — consolidación de recordatorios (1 por torneo/día/usuario).
describe('consolidateReminderTargets', () => {
  const m = (id: string, tournament_id: string | null, starts_at: string) => ({
    id,
    tournament_id,
    starts_at,
  });

  test('(a) dos sub-partidos del mismo torneo → UN representante (el más temprano)', () => {
    const targets = consolidateReminderTargets([
      m('sub-late', 'cab-1', '2026-06-14T18:00:00.000Z'),
      m('sub-early', 'cab-1', '2026-06-14T10:00:00.000Z'),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.id).toBe('sub-early');
    // (c) el ancla del recordatorio es la CABECERA → deep_link a la convocatoria única.
    expect(callupEventIdFor(targets[0]!)).toBe('cab-1');
  });

  test('(b) dos partidos NORMALES del mismo equipo → DOS representantes (sin cambio)', () => {
    const targets = consolidateReminderTargets([
      m('n1', null, '2026-06-14T10:00:00.000Z'),
      m('n2', null, '2026-06-15T10:00:00.000Z'),
    ]);
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.id).sort()).toEqual(['n1', 'n2']);
    // Partido normal → ancla = su propio id.
    expect(callupEventIdFor(targets[0]!)).toBe(targets[0]!.id);
  });

  test('mezcla torneo + normales: 1 por torneo + 1 por partido normal', () => {
    const targets = consolidateReminderTargets([
      m('sA', 'cab-1', '2026-06-14T10:00:00.000Z'),
      m('sB', 'cab-1', '2026-06-14T18:00:00.000Z'),
      m('sC', 'cab-2', '2026-06-15T10:00:00.000Z'),
      m('n1', null, '2026-06-16T10:00:00.000Z'),
    ]);
    // cab-1 (1) + cab-2 (1) + n1 (1) = 3.
    expect(targets).toHaveLength(3);
    expect(new Set(targets.map((t) => callupEventIdFor(t)))).toEqual(
      new Set(['cab-1', 'cab-2', 'n1']),
    );
  });

  test('no muta el array de entrada', () => {
    const input = [
      m('sB', 'cab-1', '2026-06-14T18:00:00.000Z'),
      m('sA', 'cab-1', '2026-06-14T10:00:00.000Z'),
    ];
    const snapshot = input.map((x) => x.id);
    consolidateReminderTargets(input);
    expect(input.map((x) => x.id)).toEqual(snapshot);
  });
});

// F13B — afloramiento en Home: la convocatoria publicada se resuelve por ANCLA.
describe('filterPublishedByAnchor', () => {
  const ev = (id: string, tournament_id: string | null) => ({ id, tournament_id });

  test('(b) sub-partido de torneo aflora sii la CABECERA está publicada', () => {
    const sub = ev('sub-1', 'cab-1');
    // Publicada la cabecera → aflora.
    expect(filterPublishedByAnchor([sub], new Set(['cab-1']))).toEqual([sub]);
    // Publicada solo su meta propia (id del sub) → NO aflora (era el bug).
    expect(filterPublishedByAnchor([sub], new Set(['sub-1']))).toEqual([]);
  });

  test('(c) partido normal aflora sii SU propia convocatoria está publicada', () => {
    const normal = ev('n-1', null);
    expect(filterPublishedByAnchor([normal], new Set(['n-1']))).toEqual([normal]);
    expect(filterPublishedByAnchor([normal], new Set(['otro']))).toEqual([]);
  });

  test('mezcla: solo afloran los de ancla publicada', () => {
    const events = [ev('sub', 'cab'), ev('n', null)];
    expect(
      filterPublishedByAnchor(events, new Set(['cab'])).map((e) => e.id),
    ).toEqual(['sub']);
  });
});

// F13B (T-5) — agrupación de "Gestión de partidos" por torneo.
describe('groupCallupsByTournament', () => {
  const row = (
    event_id: string,
    type: string,
    tournament_id: string | null,
    round: number | null,
    starts_at: string,
  ) => ({ event_id, type, tournament_id, round, starts_at });

  test('cabecera + sub-partidos → un grupo, partidos por ronda', () => {
    const rows = [
      row('h1', 'tournament', null, null, '2026-06-10T10:00:00.000Z'),
      row('m2', 'match', 'h1', 2, '2026-06-17T10:00:00.000Z'),
      row('m1', 'match', 'h1', 1, '2026-06-10T10:00:00.000Z'),
    ];
    const groups = groupCallupsByTournament(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.kind).toBe('tournament');
    if (g?.kind !== 'tournament') throw new Error('expected tournament group');
    expect(g.header.event_id).toBe('h1');
    expect(g.matches.map((m) => m.event_id)).toEqual(['m1', 'm2']);
  });

  test('partidos normales quedan sueltos', () => {
    const rows = [
      row('a', 'match', null, null, '2026-06-12T10:00:00.000Z'),
      row('b', 'friendly', null, null, '2026-06-11T10:00:00.000Z'),
    ];
    const groups = groupCallupsByTournament(rows);
    expect(groups.map((g) => g.kind)).toEqual(['single', 'single']);
    // Ordenados por fecha: b (11) antes que a (12).
    expect(groups.map((g) => (g.kind === 'single' ? g.match.event_id : ''))).toEqual(['b', 'a']);
  });

  test('mezcla torneo + suelto ordenados por fecha (cabecera = 1er partido)', () => {
    const rows = [
      row('single', 'match', null, null, '2026-06-15T10:00:00.000Z'),
      row('h1', 'tournament', null, null, '2026-06-10T10:00:00.000Z'),
      row('m1', 'match', 'h1', 1, '2026-06-10T10:00:00.000Z'),
    ];
    const groups = groupCallupsByTournament(rows);
    expect(groups.map((g) => g.kind)).toEqual(['tournament', 'single']);
  });

  test('sub-partido huérfano (sin cabecera en rows) → suelto, no se pierde', () => {
    const rows = [row('m2', 'match', 'h1', 2, '2026-06-17T10:00:00.000Z')];
    const groups = groupCallupsByTournament(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('single');
  });

  test('no muta el array de entrada', () => {
    const rows = [
      row('m2', 'match', 'h1', 2, '2026-06-17T10:00:00.000Z'),
      row('m1', 'match', 'h1', 1, '2026-06-10T10:00:00.000Z'),
      row('h1', 'tournament', null, null, '2026-06-10T10:00:00.000Z'),
    ];
    const snapshot = rows.map((r) => r.event_id);
    groupCallupsByTournament(rows);
    expect(rows.map((r) => r.event_id)).toEqual(snapshot);
  });
});

describe('pickNextEvent', () => {
  test('returns the earliest future event', () => {
    const events = [
      { id: 'a', starts_at: '2026-06-15T08:00:00.000Z' }, // pasado
      { id: 'b', starts_at: '2026-06-20T10:00:00.000Z' },
      { id: 'c', starts_at: '2026-06-16T10:00:00.000Z' },
    ];
    expect(pickNextEvent(events, NOW)?.id).toBe('c');
  });

  test('returns null when nothing in future', () => {
    expect(pickNextEvent([{ id: 'a', starts_at: '2026-06-14' }], NOW)).toBeNull();
  });

  test('applies predicate', () => {
    const events = [
      { id: 'a', starts_at: '2026-06-16', type: 'match' },
      { id: 'b', starts_at: '2026-06-17', type: 'training' },
    ];
    expect(
      pickNextEvent(events, NOW, (e) => e.type === 'training')?.id
    ).toBe('b');
  });

  test('strictly future — excludes equal-to-now', () => {
    expect(
      pickNextEvent([{ id: 'a', starts_at: NOW }], NOW)
    ).toBeNull();
  });
});

describe('pickLastEventWithin', () => {
  test('most recent past event inside window', () => {
    const events = [
      { id: 'a', starts_at: '2026-06-15T08:00:00.000Z' }, // 2h ago
      { id: 'b', starts_at: '2026-06-12T10:00:00.000Z' }, // 72h ago (en borde)
      { id: 'c', starts_at: '2026-06-15T09:00:00.000Z' }, // 1h ago
    ];
    expect(pickLastEventWithin(events, NOW, 72)?.id).toBe('c');
  });

  test('excludes events older than window', () => {
    const events = [
      { id: 'old', starts_at: '2026-06-10T10:00:00.000Z' }, // 5 días ago
    ];
    expect(pickLastEventWithin(events, NOW, 72)).toBeNull();
  });

  test('includes events exactly at the lower bound', () => {
    const events = [{ id: 'x', starts_at: '2026-06-12T10:00:00.000Z' }];
    expect(pickLastEventWithin(events, NOW, 72)?.id).toBe('x');
  });

  test('predicate filters out non-matching events', () => {
    const events = [
      { id: 'a', starts_at: '2026-06-15T09:00:00.000Z', type: 'match' },
      { id: 'b', starts_at: '2026-06-15T08:00:00.000Z', type: 'training' },
    ];
    expect(
      pickLastEventWithin(events, NOW, 24, (e) => e.type === 'training')?.id
    ).toBe('b');
  });

  test('returns null when no past event qualifies', () => {
    expect(
      pickLastEventWithin([{ id: 'a', starts_at: '2026-06-20' }], NOW, 72)
    ).toBeNull();
  });
});

describe('pickNextMatchWithoutCallup', () => {
  test('skips matches with published callup', () => {
    const events = [
      { id: 'm1', starts_at: '2026-06-16', type: 'match' },
      { id: 'm2', starts_at: '2026-06-17', type: 'match' },
    ];
    const published = new Set(['m1']);
    expect(pickNextMatchWithoutCallup(events, NOW, published)?.id).toBe('m2');
  });

  test('ignores training events', () => {
    const events = [
      { id: 't1', starts_at: '2026-06-16', type: 'training' },
      { id: 'm1', starts_at: '2026-06-18', type: 'match' },
    ];
    expect(
      pickNextMatchWithoutCallup(events, NOW, new Set())?.id
    ).toBe('m1');
  });

  test('returns null when all matches have callup', () => {
    const events = [{ id: 'm1', starts_at: '2026-06-16', type: 'match' }];
    expect(
      pickNextMatchWithoutCallup(events, NOW, new Set(['m1']))
    ).toBeNull();
  });

  // F13B — un amistoso es superficie de partido: cuenta como "próximo partido".
  test('includes friendly matches (F13B)', () => {
    const events = [
      { id: 't1', starts_at: '2026-06-16', type: 'training' },
      { id: 'f1', starts_at: '2026-06-17', type: 'friendly' },
      { id: 'm1', starts_at: '2026-06-18', type: 'match' },
    ];
    // El amistoso f1 es el más próximo → se elige antes que el oficial m1.
    expect(pickNextMatchWithoutCallup(events, NOW, new Set())?.id).toBe('f1');
  });

  // El torneo NO es superficie de partido todavía (fase aparte).
  test('excludes tournament (own phase)', () => {
    const events = [{ id: 'to1', starts_at: '2026-06-16', type: 'tournament' }];
    expect(pickNextMatchWithoutCallup(events, NOW, new Set())).toBeNull();
  });
});

describe('pickLastTrainingWithoutAttendance', () => {
  test('last training in window not yet marked', () => {
    const events = [
      { id: 't1', starts_at: '2026-06-14T10:00:00.000Z', type: 'training' },
      { id: 't2', starts_at: '2026-06-15T09:00:00.000Z', type: 'training' },
    ];
    expect(
      pickLastTrainingWithoutAttendance(events, NOW, 72, new Set())?.id
    ).toBe('t2');
  });

  test('skips trainings already marked', () => {
    const events = [
      { id: 't1', starts_at: '2026-06-15T08:00:00.000Z', type: 'training' },
      { id: 't2', starts_at: '2026-06-15T09:00:00.000Z', type: 'training' },
    ];
    expect(
      pickLastTrainingWithoutAttendance(
        events,
        NOW,
        24,
        new Set(['t2'])
      )?.id
    ).toBe('t1');
  });

  test('ignores match events', () => {
    const events = [
      { id: 'm1', starts_at: '2026-06-15T09:00:00.000Z', type: 'match' },
    ];
    expect(
      pickLastTrainingWithoutAttendance(events, NOW, 24, new Set())
    ).toBeNull();
  });
});
