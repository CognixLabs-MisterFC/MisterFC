import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  MANAGEABLE_MATCH_TYPES,
  MATCH_SURFACE_TYPES,
  isManageableMatchType,
  isMatchSurfaceType,
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

// F13B — superficies secundarias (próximo partido, recordatorios, mis-equipos):
// match + friendly, con tournament FUERA hasta su fase.
describe('MATCH_SURFACE_TYPES / isMatchSurfaceType', () => {
  it('es match + friendly, sin tournament', () => {
    expect([...MATCH_SURFACE_TYPES]).toEqual(['match', 'friendly']);
  });

  it('es un subconjunto de MANAGEABLE_MATCH_TYPES', () => {
    for (const t of MATCH_SURFACE_TYPES) {
      expect(MANAGEABLE_MATCH_TYPES).toContain(t);
    }
  });

  it('true para match / friendly; false para tournament / training / nullish', () => {
    expect(isMatchSurfaceType('match')).toBe(true);
    expect(isMatchSurfaceType('friendly')).toBe(true);
    expect(isMatchSurfaceType('tournament')).toBe(false);
    expect(isMatchSurfaceType('training')).toBe(false);
    expect(isMatchSurfaceType(null)).toBe(false);
    expect(isMatchSurfaceType(undefined)).toBe(false);
  });
});
