/**
 * F13.10a — Contrato del dominio "Informe de desarrollo" (development report).
 *
 * Informe trimestral de desarrollo del jugador por temporada: 4 ejes ("4 corners"
 * del fútbol de cantera) puntuados 1–5 + comentarios, en 4 periodos comparables
 * (inicial/diciembre/marzo/junio). Objetivos individuales (del jugador) y de
 * equipo, con estado. Molde: plays/sessions (constantes + zod + barrel). Aquí
 * solo el contrato puro (sin BD ni React). NO confundir con `evaluations` (F8),
 * que es la nota 1–10 por partido — es otro dominio.
 */

import { z } from 'zod';

/** Los 4 ejes ("4 corners", FA inglesa) — vocabulario fijo y uniforme (D2/D11). */
export const DEVELOPMENT_AXES = [
  'tecnica_tactica',
  'fisica',
  'psicologica',
  'social',
] as const;
export type DevelopmentAxis = (typeof DEVELOPMENT_AXES)[number];

/** Escala de puntuación por eje (1–5, con descriptores en i18n). */
export const DEVELOPMENT_SCORE_MIN = 1;
export const DEVELOPMENT_SCORE_MAX = 5;

/** Los 4 periodos fijos de la temporada (D4). El orden ES el cronológico. */
export const DEVELOPMENT_PERIODS = ['inicial', 'diciembre', 'marzo', 'junio'] as const;
export type DevelopmentPeriod = (typeof DEVELOPMENT_PERIODS)[number];

/** Estado de un objetivo (D6). */
export const OBJECTIVE_STATUSES = ['open', 'achieved', 'dropped'] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

/** Compartir por informe (D8/D14): 'staff' (privado) ↔ 'team' (lo ve la familia). */
export const DEVELOPMENT_VISIBILITIES = ['staff', 'team'] as const;
export type DevelopmentVisibility = (typeof DEVELOPMENT_VISIBILITIES)[number];

export const DEVELOPMENT_COMMENT_MAX = 2000;
export const OBJECTIVE_TITLE_MAX = 200;
export const OBJECTIVE_DESCRIPTION_MAX = 2000;

export function isDevelopmentAxis(v: unknown): v is DevelopmentAxis {
  return typeof v === 'string' && (DEVELOPMENT_AXES as readonly string[]).includes(v);
}
export function isDevelopmentPeriod(v: unknown): v is DevelopmentPeriod {
  return typeof v === 'string' && (DEVELOPMENT_PERIODS as readonly string[]).includes(v);
}

// ── Primitivas zod ────────────────────────────────────────────────────────────

/** Puntuación de un eje: entero 1–5 o null (vacío → null). */
const scoreField = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z
    .number()
    .int()
    .min(DEVELOPMENT_SCORE_MIN)
    .max(DEVELOPMENT_SCORE_MAX)
    .nullable(),
);

/** Comentario libre: texto recortado o null (vacío → null). */
const commentField = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).max(DEVELOPMENT_COMMENT_MAX).nullable(),
);

const periodSchema = z.enum(DEVELOPMENT_PERIODS, { message: 'period_invalid' });
const visibilitySchema = z.enum(DEVELOPMENT_VISIBILITIES, { message: 'visibility_invalid' });
const objectiveStatusSchema = z.enum(OBJECTIVE_STATUSES, { message: 'status_invalid' });

// ── Informe de desarrollo ──────────────────────────────────────────────────────

/** Crear/editar un informe de un periodo. `id` presente = update. */
export const upsertDevelopmentReportSchema = z.object({
  id: z.string().uuid().optional(),
  player_id: z.string().uuid(),
  team_id: z.string().uuid(),
  season_id: z.string().uuid(),
  period: periodSchema,
  score_tecnica_tactica: scoreField,
  score_fisica: scoreField,
  score_psicologica: scoreField,
  score_social: scoreField,
  comment_tecnica_tactica: commentField,
  comment_fisica: commentField,
  comment_psicologica: commentField,
  comment_social: commentField,
  comment_overall: commentField,
  visibility: visibilitySchema.default('staff'),
});
export type UpsertDevelopmentReportInput = z.infer<typeof upsertDevelopmentReportSchema>;

export const deleteDevelopmentReportSchema = z.object({ id: z.string().uuid() });
export type DeleteDevelopmentReportInput = z.infer<typeof deleteDevelopmentReportSchema>;

// ── Objetivos ───────────────────────────────────────────────────────────────────

/** Objetivo individual de un jugador en una temporada. */
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

/** Objetivo grupal de un equipo en una temporada (sin periodo: vive toda la temporada). */
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
