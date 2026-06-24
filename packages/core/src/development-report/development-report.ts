/**
 * F13.10 (rework) — Contrato del dominio "Informe de desarrollo".
 *
 * Modelo real (definido con el usuario): valoración de EQUIPO (común por
 * equipo×season×periodo) + INFORME INDIVIDUAL (por jugador×season×periodo) que
 * referencia a la del equipo. Las puntuaciones son por ÍTEM (escala 1–10) en un
 * `scores` jsonb validado contra un CATÁLOGO versionado (no columnas). Las medias
 * por grupo se calculan en core (computeGroupAverages). NO confundir con
 * `evaluations` (F8, nota 1–10 por partido).
 *
 * Sustituye al esquema de 4 corners de 13.10a (que se elimina en el rework).
 */

import { z } from 'zod';

// ── Escala y periodos ──────────────────────────────────────────────────────────
export const DEVELOPMENT_SCORE_MIN = 1;
export const DEVELOPMENT_SCORE_MAX = 10;

/** Los 4 periodos fijos de la temporada. El orden ES el cronológico. */
export const DEVELOPMENT_PERIODS = ['inicial', 'diciembre', 'marzo', 'junio'] as const;
export type DevelopmentPeriod = (typeof DEVELOPMENT_PERIODS)[number];

/** Estado de un objetivo. */
export const OBJECTIVE_STATUSES = ['open', 'achieved', 'dropped'] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

/** Compartir por informe: 'staff' (privado) ↔ 'team' (lo ve la familia). */
export const DEVELOPMENT_VISIBILITIES = ['staff', 'team'] as const;
export type DevelopmentVisibility = (typeof DEVELOPMENT_VISIBILITIES)[number];

export const DEVELOPMENT_COMMENT_MAX = 2000;
export const OBJECTIVE_TITLE_MAX = 200;
export const OBJECTIVE_DESCRIPTION_MAX = 2000;

// ── Catálogos (grupos → ítems). Versionados; las labels viven en i18n por id. ───
export type CatalogGroup = { readonly id: string; readonly items: readonly string[] };
export type Catalog = { readonly version: number; readonly groups: readonly CatalogGroup[] };

/** Catálogo del INFORME INDIVIDUAL: 4 grupos (técnico/táctico/físico/actitud). */
export const DEVELOPMENT_REPORT_CATALOG = {
  version: 1,
  groups: [
    {
      id: 'tecnico',
      items: ['control_orientado', 'pase', 'conduccion', 'regate', 'finalizacion', 'primer_toque'],
    },
    {
      id: 'tactico',
      items: ['comprension_juego', 'toma_decisiones', 'ocupacion_espacios', 'lectura_tactica', 'juego_sin_balon'],
    },
    {
      id: 'fisico',
      items: ['coordinacion', 'agilidad', 'velocidad', 'resistencia', 'explosividad'],
    },
    {
      id: 'actitud',
      items: ['compromiso', 'motivacion', 'concentracion', 'companerismo', 'liderazgo', 'evolucion'],
    },
  ],
} as const satisfies Catalog;

/** Catálogo de la VALORACIÓN DE EQUIPO: 3 grupos. */
export const TEAM_REPORT_CATALOG = {
  version: 1,
  groups: [
    {
      id: 'rendimiento_colectivo',
      items: ['organizacion_defensiva', 'organizacion_ofensiva', 'transiciones', 'balon_parado'],
    },
    {
      id: 'dinamica_grupo',
      items: ['cohesion_ambiente', 'actitud_competitiva', 'disciplina_compromiso'],
    },
    {
      id: 'evolucion_equipo',
      items: ['progresion_periodo_anterior', 'cumplimiento_objetivos'],
    },
  ],
} as const satisfies Catalog;

/** Conjunto de ids de ítem válidos de un catálogo. */
export function catalogItemIds(catalog: Catalog): string[] {
  return catalog.groups.flatMap((g) => [...g.items]);
}

export function isDevelopmentPeriod(v: unknown): v is DevelopmentPeriod {
  return typeof v === 'string' && (DEVELOPMENT_PERIODS as readonly string[]).includes(v);
}

/** Medias por grupo (media de los ítems puntuados; null si ninguno) + media global. */
export function computeGroupAverages(
  catalog: Catalog,
  scores: Record<string, number>,
): { perGroup: Record<string, number | null>; overall: number | null } {
  const perGroup: Record<string, number | null> = {};
  let allSum = 0;
  let allCount = 0;
  for (const g of catalog.groups) {
    let sum = 0;
    let count = 0;
    for (const item of g.items) {
      const v = scores[item];
      if (typeof v === 'number') {
        sum += v;
        count += 1;
        allSum += v;
        allCount += 1;
      }
    }
    perGroup[g.id] = count > 0 ? sum / count : null;
  }
  return { perGroup, overall: allCount > 0 ? allSum / allCount : null };
}

/** Nº de ítems del catálogo con puntuación numérica (1–10). */
export function countScoredItems(scores: Record<string, number>, catalog: Catalog): number {
  return catalogItemIds(catalog).filter((id) => typeof scores[id] === 'number').length;
}

/** "Completado" = TODOS los ítems del catálogo puntuados. Solo cuenta las
 *  puntuaciones numéricas; comentario y objetivos NO condicionan el estado. */
export function isReportComplete(scores: Record<string, number>, catalog: Catalog): boolean {
  const ids = catalogItemIds(catalog);
  return ids.length > 0 && ids.every((id) => typeof scores[id] === 'number');
}

/** Estado calculado de un informe a partir de sus puntuaciones (no es un campo). */
export type ReportStatus = 'not_started' | 'in_progress' | 'completed';
export function reportStatus(scores: Record<string, number>, catalog: Catalog): ReportStatus {
  const total = catalogItemIds(catalog).length;
  const scored = countScoredItems(scores, catalog);
  if (scored === 0) return 'not_started';
  if (scored >= total) return 'completed';
  return 'in_progress';
}

// ── Primitivas zod ────────────────────────────────────────────────────────────
const commentField = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).max(DEVELOPMENT_COMMENT_MAX).nullable(),
);

const periodSchema = z.enum(DEVELOPMENT_PERIODS, { message: 'period_invalid' });
const visibilitySchema = z.enum(DEVELOPMENT_VISIBILITIES, { message: 'visibility_invalid' });
const objectiveStatusSchema = z.enum(OBJECTIVE_STATUSES, { message: 'status_invalid' });

/** Schema de `scores` (item_id → 1..10) validado contra un catálogo: enteros en
 *  rango y SOLO ids del catálogo (parcial: no hace falta puntuar todos). */
function scoresSchemaForCatalog(catalog: Catalog) {
  const ids = new Set(catalogItemIds(catalog));
  return z
    .record(
      z.string(),
      z.number().int().min(DEVELOPMENT_SCORE_MIN).max(DEVELOPMENT_SCORE_MAX),
    )
    .refine((obj) => Object.keys(obj).every((k) => ids.has(k)), {
      message: 'unknown_score_item',
    });
}

export const developmentScoresSchema = scoresSchemaForCatalog(DEVELOPMENT_REPORT_CATALOG);
export const teamScoresSchema = scoresSchemaForCatalog(TEAM_REPORT_CATALOG);

// ── Informe individual ──────────────────────────────────────────────────────────
export const upsertDevelopmentReportSchema = z.object({
  id: z.string().uuid().optional(),
  player_id: z.string().uuid(),
  team_id: z.string().uuid(),
  season_id: z.string().uuid(),
  period: periodSchema,
  scores: developmentScoresSchema.default({}),
  comment_overall: commentField,
  visibility: visibilitySchema.default('staff'),
});
export type UpsertDevelopmentReportInput = z.infer<typeof upsertDevelopmentReportSchema>;

export const deleteDevelopmentReportSchema = z.object({ id: z.string().uuid() });
export type DeleteDevelopmentReportInput = z.infer<typeof deleteDevelopmentReportSchema>;

// ── Valoración de equipo ─────────────────────────────────────────────────────────
export const upsertTeamDevelopmentReportSchema = z.object({
  id: z.string().uuid().optional(),
  team_id: z.string().uuid(),
  season_id: z.string().uuid(),
  period: periodSchema,
  scores: teamScoresSchema.default({}),
  comment: commentField,
  visibility: visibilitySchema.default('staff'),
});
export type UpsertTeamDevelopmentReportInput = z.infer<typeof upsertTeamDevelopmentReportSchema>;

// ── Objetivos (sin cambios respecto a 13.10a) ────────────────────────────────────
export const upsertPlayerObjectiveSchema = z.object({
  id: z.string().uuid().optional(),
  player_id: z.string().uuid(),
  team_id: z.string().uuid(),
  season_id: z.string().uuid(),
  title: z.string().trim().min(1).max(OBJECTIVE_TITLE_MAX),
  description: commentField,
  status: objectiveStatusSchema.default('open'),
  created_period: periodSchema,
});
export type UpsertPlayerObjectiveInput = z.infer<typeof upsertPlayerObjectiveSchema>;

export const upsertTeamObjectiveSchema = z.object({
  id: z.string().uuid().optional(),
  team_id: z.string().uuid(),
  season_id: z.string().uuid(),
  title: z.string().trim().min(1).max(OBJECTIVE_TITLE_MAX),
  description: commentField,
  status: objectiveStatusSchema.default('open'),
});
export type UpsertTeamObjectiveInput = z.infer<typeof upsertTeamObjectiveSchema>;

export const deleteObjectiveSchema = z.object({ id: z.string().uuid() });
export type DeleteObjectiveInput = z.infer<typeof deleteObjectiveSchema>;

// ── F13.10g — Fechas límite de la campaña de evaluaciones ─────────────────────────
const ymdField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_invalid');

/** Fija (o borra, due_date=null) la fecha límite de un periodo de una temporada. */
export const setAssessmentDeadlineSchema = z.object({
  season_id: z.string().uuid(),
  period: periodSchema,
  due_date: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    ymdField.nullable(),
  ),
});
export type SetAssessmentDeadlineInput = z.infer<typeof setAssessmentDeadlineSchema>;

/** Días desde `todayYmd` hasta `dueYmd` (negativo = vencida). Ambos en formato
 *  YYYY-MM-DD; el llamante calcula "hoy" en el huso del club (Europe/Madrid, D6). */
export function daysUntil(dueYmd: string, todayYmd: string): number {
  const due = Date.parse(`${dueYmd}T00:00:00Z`);
  const today = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(today)) return NaN;
  return Math.round((due - today) / 86_400_000);
}

/** Estado visual de una fecha límite respecto a hoy: vencida / próxima / ok. */
export type DeadlineState = 'overdue' | 'soon' | 'ok';
export function deadlineState(daysLeft: number, soonThresholdDays = 7): DeadlineState {
  if (Number.isNaN(daysLeft)) return 'ok';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= soonThresholdDays) return 'soon';
  return 'ok';
}
