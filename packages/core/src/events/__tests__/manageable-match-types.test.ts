import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  MANAGEABLE_MATCH_TYPES,
  isManageableMatchType,
} from '../types';

describe('MANAGEABLE_MATCH_TYPES', () => {
  it('son los tres tipos de partido gestionables', () => {
    expect([...MANAGEABLE_MATCH_TYPES]).toEqual([
      'match',
      'friendly',
      'tournament',
    ]);
  });

  it('todos pertenecen al catálogo de EVENT_TYPES', () => {
    for (const t of MANAGEABLE_MATCH_TYPES) {
      expect(EVENT_TYPES).toContain(t);
    }
  });

  it('NO incluye training ni other (no son partidos)', () => {
    expect(MANAGEABLE_MATCH_TYPES).not.toContain('training');
    expect(MANAGEABLE_MATCH_TYPES).not.toContain('other');
  });
});

describe('isManageableMatchType', () => {
  it('true para match / friendly / tournament', () => {
    expect(isManageableMatchType('match')).toBe(true);
    expect(isManageableMatchType('friendly')).toBe(true);
    expect(isManageableMatchType('tournament')).toBe(true);
  });

  it('false para training / other / desconocido / nullish', () => {
    expect(isManageableMatchType('training')).toBe(false);
    expect(isManageableMatchType('other')).toBe(false);
    expect(isManageableMatchType('partido')).toBe(false);
    expect(isManageableMatchType(null)).toBe(false);
    expect(isManageableMatchType(undefined)).toBe(false);
  });
});
