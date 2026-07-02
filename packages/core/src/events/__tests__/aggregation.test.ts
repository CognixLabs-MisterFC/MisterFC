import { describe, expect, test } from 'vitest';
import {
  pickNextEvent,
  pickLastEventWithin,
  pickNextMatchWithoutCallup,
  pickLastTrainingWithoutAttendance,
} from '../aggregation';

const NOW = '2026-06-15T10:00:00.000Z';

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
