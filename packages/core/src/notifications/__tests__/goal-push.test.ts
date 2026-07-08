import { describe, it, expect } from 'vitest';
import { formatGoalPush, resolveGoalRecipients } from '../goal-push';

describe('formatGoalPush', () => {
  it('formats "Gol {Equipo}" + "{Equipo} N - M {Rival}"', () => {
    expect(
      formatGoalPush({ teamName: 'Fonteta', opponentName: 'Valencia', own: 1, rival: 0 }),
    ).toEqual({ title: 'Gol Fonteta', body: 'Fonteta 1 - 0 Valencia' });
  });

  it('omits the rival cleanly when there is no opponent name', () => {
    expect(
      formatGoalPush({ teamName: 'Fonteta', opponentName: null, own: 2, rival: 1 }),
    ).toEqual({ title: 'Gol Fonteta', body: 'Fonteta 2 - 1' });
  });

  it('trims stray whitespace in names', () => {
    const m = formatGoalPush({ teamName: '  Fonteta ', opponentName: '  Levante  ', own: 3, rival: 2 });
    expect(m.title).toBe('Gol Fonteta');
    expect(m.body).toBe('Fonteta 3 - 2 Levante');
  });
});

describe('resolveGoalRecipients', () => {
  it('excludes the recorder, dedupes and drops empties', () => {
    const recipients = resolveGoalRecipients(
      ['u1', 'u2', 'u1', null, undefined, 'rec', ''],
      'rec',
    );
    expect(recipients).toEqual(['u1', 'u2']);
  });

  it('returns everyone when the recorder does not follow', () => {
    expect(resolveGoalRecipients(['u1', 'u2'], 'rec')).toEqual(['u1', 'u2']);
  });

  it('returns empty when the only follower is the recorder', () => {
    expect(resolveGoalRecipients(['rec'], 'rec')).toEqual([]);
  });
});
