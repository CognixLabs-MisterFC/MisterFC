/**
 * F13.10b-1 — Lecturas del Informe de desarrollo. O2-5 C1: la lógica (fetch +
 * cálculo, ya client-agnóstica) se movió a `@misterfc/core`
 * (`development-report/report-queries`); este fichero re-exporta esas funciones y
 * tipos para no cambiar los imports de las páginas (staff + /mi-informe). Cero
 * duplicación; comportamiento idéntico.
 */

export {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadIndividualReport,
  loadTeamReport,
  loadReportsByPeriod,
  loadFichaStats,
  loadPlayerEvolution,
  loadTeamEvolution,
} from '@misterfc/core';
export type {
  ClubSeason,
  DevelopmentReportRow,
  IndividualReport,
  TeamReport,
  ObjectiveRow,
  FichaPromotionItem,
  FichaPromotionGroup,
  FichaPromotions,
  FichaMatchLine,
  FichaMatchStatsByType,
  FichaStats,
  PeriodAverages,
  TeamPeriodAverages,
} from '@misterfc/core';
