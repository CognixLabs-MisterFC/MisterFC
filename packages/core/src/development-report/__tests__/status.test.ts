import { describe, it, expect } from 'vitest';
import {
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  catalogItemIds,
  countScoredItems,
  isReportComplete,
  reportStatus,
  type Catalog,
} from '../development-report';

/** Puntúa todos los ítems del catálogo (al valor dado) → scores completos. */
function fullScores(catalog: Catalog, value = 7): Record<string, number> {
  return Object.fromEntries(catalogItemIds(catalog).map((id) => [id, value]));
}

describe('isReportComplete / reportStatus', () => {
  it('vacío = not_started, no completo', () => {
    expect(reportStatus({}, DEVELOPMENT_REPORT_CATALOG)).toBe('not_started');
    expect(isReportComplete({}, DEVELOPMENT_REPORT_CATALOG)).toBe(false);
    expect(countScoredItems({}, DEVELOPMENT_REPORT_CATALOG)).toBe(0);
  });

  it('algunos ítems = in_progress', () => {
    const ids = catalogItemIds(DEVELOPMENT_REPORT_CATALOG);
    const partial = { [ids[0]!]: 5, [ids[1]!]: 8 };
    expect(reportStatus(partial, DEVELOPMENT_REPORT_CATALOG)).toBe('in_progress');
    expect(isReportComplete(partial, DEVELOPMENT_REPORT_CATALOG)).toBe(false);
    expect(countScoredItems(partial, DEVELOPMENT_REPORT_CATALOG)).toBe(2);
  });

  it('todos los ítems = completed (individual y equipo)', () => {
    expect(isReportComplete(fullScores(DEVELOPMENT_REPORT_CATALOG), DEVELOPMENT_REPORT_CATALOG)).toBe(true);
    expect(reportStatus(fullScores(DEVELOPMENT_REPORT_CATALOG), DEVELOPMENT_REPORT_CATALOG)).toBe('completed');
    expect(isReportComplete(fullScores(TEAM_REPORT_CATALOG), TEAM_REPORT_CATALOG)).toBe(true);
    expect(reportStatus(fullScores(TEAM_REPORT_CATALOG), TEAM_REPORT_CATALOG)).toBe('completed');
  });

  it('completo de un catálogo no cuenta para el otro', () => {
    // las puntuaciones del catálogo individual no completan el de equipo
    expect(isReportComplete(fullScores(DEVELOPMENT_REPORT_CATALOG), TEAM_REPORT_CATALOG)).toBe(false);
  });
});
