import { describe, it, expect } from 'vitest';
import {
  assertCategoryDeletable,
  resolveCategoryUpdate,
  customOverlapsStandardKind,
  activeSeasonLabel,
  nextSeasonLabel,
  seasonEndDate,
  teamsInActiveSeason,
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

describe('activeSeasonLabel (C5)', () => {
  it('devuelve el label de la activa', () => {
    expect(
      activeSeasonLabel([
        { label: '2024-25', status: 'finalized' },
        { label: '2025-26', status: 'active' },
      ])
    ).toBe('2025-26');
  });

  it('null si no hay activa', () => {
    expect(activeSeasonLabel([{ label: '2024-25', status: 'finalized' }])).toBeNull();
    expect(activeSeasonLabel([])).toBeNull();
  });
});

describe('nextSeasonLabel (C5)', () => {
  it('incrementa el año: 2025-26 → 2026-27', () => {
    expect(nextSeasonLabel('2025-26')).toBe('2026-27');
  });

  it('cruce de siglo: 2099-00 → 2100-01', () => {
    expect(nextSeasonLabel('2099-00')).toBe('2100-01');
  });

  it('label inválido → cae a currentSeason (no lanza)', () => {
    expect(nextSeasonLabel('basura')).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('seasonEndDate (C8)', () => {
  it('límite = 31-jul del año de cierre: 2025-26 → 2026-07-31', () => {
    expect(seasonEndDate('2025-26')).toBe('2026-07-31');
  });

  it('cruce de siglo: 2099-00 → 2100-07-31', () => {
    expect(seasonEndDate('2099-00')).toBe('2100-07-31');
  });

  it('label inválido → null (el caller decide el fallback)', () => {
    expect(seasonEndDate('basura')).toBeNull();
  });
});

describe('teamsInActiveSeason (Bug-1 scope)', () => {
  const teams = [
    { id: 'a25', name: 'Alevín A', season: '2025-26' },
    { id: 'a26', name: 'Alevín A', season: '2026-27' }, // mismo nombre, otra temporada
    { id: 'b26', name: 'Alevín B', season: '2026-27' },
  ];

  it('devuelve solo los equipos de la temporada activa', () => {
    const out = teamsInActiveSeason(teams, '2026-27');
    expect(out.map((t) => t.id)).toEqual(['a26', 'b26']);
  });

  it('elimina los duplicados por nombre del rollover (un "Alevín A")', () => {
    const out = teamsInActiveSeason(teams, '2026-27');
    const alevinA = out.filter((t) => t.name === 'Alevín A');
    expect(alevinA).toHaveLength(1);
    expect(alevinA[0]!.season).toBe('2026-27');
  });

  it('temporada sin equipos → lista vacía', () => {
    expect(teamsInActiveSeason(teams, '2024-25')).toEqual([]);
  });
});
