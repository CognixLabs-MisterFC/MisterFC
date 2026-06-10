import { describe, it, expect } from 'vitest';
import {
  assertCategoryDeletable,
  resolveCategoryUpdate,
  customOverlapsStandardKind,
} from '../club-structure';

describe('assertCategoryDeletable (C3)', () => {
  it('estándar → is_standard (no borrable)', () => {
    expect(assertCategoryDeletable({ isStandard: true, teamsCount: 0 })).toBe('is_standard');
    expect(assertCategoryDeletable({ isStandard: true, teamsCount: 5 })).toBe('is_standard');
  });

  it('custom con equipos → has_teams (protege histórico del CASCADE)', () => {
    expect(assertCategoryDeletable({ isStandard: false, teamsCount: 1 })).toBe('has_teams');
  });

  it('custom sin equipos → ok', () => {
    expect(assertCategoryDeletable({ isStandard: false, teamsCount: 0 })).toBe('ok');
  });
});

describe('resolveCategoryUpdate (C3)', () => {
  const existing = { name: 'Infantil', kind: 'infantil' as string | null };

  it('estándar: name + kind CONGELADOS, solo cambia half_duration', () => {
    const out = resolveCategoryUpdate({
      isStandard: true,
      existing,
      input: { name: 'Renombrada', kind: 'cadete', half_duration_minutes: 30 },
    });
    expect(out).toEqual({ name: 'Infantil', kind: 'infantil', half_duration_minutes: 30 });
  });

  it('custom: se aplican los tres campos del input', () => {
    const out = resolveCategoryUpdate({
      isStandard: false,
      existing: { name: 'Escuela', kind: null },
      input: { name: 'Escuela B', kind: 'querubin', half_duration_minutes: 15 },
    });
    expect(out).toEqual({ name: 'Escuela B', kind: 'querubin', half_duration_minutes: 15 });
  });
});

describe('customOverlapsStandardKind (C3)', () => {
  it('custom con kind canónico (nombre distinto) → true (match ambiguo, avisar)', () => {
    expect(customOverlapsStandardKind({ isStandard: false, kind: 'infantil' })).toBe(true);
  });

  it('custom sin kind → false', () => {
    expect(customOverlapsStandardKind({ isStandard: false, kind: null })).toBe(false);
  });

  it('custom con kind no canónico → false', () => {
    expect(customOverlapsStandardKind({ isStandard: false, kind: 'futbol7' })).toBe(false);
  });

  it('estándar → false (nunca se avisa)', () => {
    expect(customOverlapsStandardKind({ isStandard: true, kind: 'infantil' })).toBe(false);
  });
});
