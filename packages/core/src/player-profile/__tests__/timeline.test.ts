import { describe, it, expect } from 'vitest';
import {
  ratingTimeline,
  timelineHasRatings,
  type MatchRatingInput,
} from '../timeline';

function m(over: Partial<MatchRatingInput> = {}): MatchRatingInput {
  return {
    eventId: 'e',
    startsAt: '2026-01-01T10:00:00+00:00',
    label: 'Rival',
    rating: null,
    teamRating: null,
    ...over,
  };
}

describe('ratingTimeline', () => {
  it('ordena cronológicamente (ascendente por startsAt)', () => {
    const out = ratingTimeline([
      m({ eventId: 'c', startsAt: '2026-03-01T10:00:00+00:00' }),
      m({ eventId: 'a', startsAt: '2026-01-15T10:00:00+00:00' }),
      m({ eventId: 'b', startsAt: '2026-02-10T10:00:00+00:00' }),
    ]);
    expect(out.map((p) => p.eventId)).toEqual(['a', 'b', 'c']);
  });

  it('conserva los null como huecos (no interpola ni pone 0)', () => {
    const out = ratingTimeline([
      m({ eventId: 'a', startsAt: '2026-01-01T10:00:00+00:00', rating: 7 }),
      m({ eventId: 'b', startsAt: '2026-01-08T10:00:00+00:00', rating: null }),
    ]);
    expect(out[1]!.rating).toBeNull();
  });

  it('no muta el array de entrada', () => {
    const input = [
      m({ eventId: 'c', startsAt: '2026-03-01T10:00:00+00:00' }),
      m({ eventId: 'a', startsAt: '2026-01-15T10:00:00+00:00' }),
    ];
    const snapshot = input.map((p) => p.eventId);
    ratingTimeline(input);
    expect(input.map((p) => p.eventId)).toEqual(snapshot);
  });

  it('lista vacía → vacío', () => {
    expect(ratingTimeline([])).toEqual([]);
  });
});

describe('timelineHasRatings', () => {
  it('false si todas las notas son null', () => {
    expect(timelineHasRatings([m(), m()])).toBe(false);
  });
  it('true si hay alguna nota individual', () => {
    expect(timelineHasRatings([m(), m({ rating: 6 })])).toBe(true);
  });
  it('true si hay alguna nota colectiva (aunque la individual falte)', () => {
    expect(timelineHasRatings([m({ teamRating: 8 })])).toBe(true);
  });
});
