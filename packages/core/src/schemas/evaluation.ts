/**
 * F8 — Schemas de valoraciones (partido y entrenamiento).
 *
 * Contrato compartido por las server actions de F8.2 (partido) y F8.3 (entreno).
 * El modelo vive en `evaluations` (migración 20260622000000): una fila por
 * (event_id, player_id), upsert (D9).
 *
 * NOTA — `rating` es nullable AQUÍ a propósito: la obligatoriedad en PARTIDO es a
 * nivel de fila y depende de `events.type`, algo que el schema no conoce. El
 * cliente la valida (no deja guardar) y el trigger de la BD es la red final
 * (`rating_required_for_match`). En entreno (8.3) el rating es opcional.
 */

import { z } from 'zod';

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const EVALUATION_COMMENT_MAX = 2000;

/** Comentario: '' o solo-espacios → null; si no, recortado y 1..2000. */
const commentField = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).max(EVALUATION_COMMENT_MAX).nullable(),
);

export const upsertEvaluationSchema = z
  .object({
    event_id: z.string().uuid(),
    player_id: z.string().uuid(),
    rating: z.number().int().min(RATING_MIN).max(RATING_MAX).nullable(),
    comment: commentField,
    is_mvp: z.boolean().default(false),
  })
  // Espejo de la regla "no fila vacía" del trigger: al menos un campo con
  // contenido (rating, comentario o MVP).
  .refine(
    (v) => v.rating != null || v.comment != null || v.is_mvp,
    { message: 'empty_evaluation' },
  );

export const deleteEvaluationSchema = z.object({
  event_id: z.string().uuid(),
  player_id: z.string().uuid(),
});

/** F8 — cerrar/abrir la etapa post-partido (match_state.post_match_done, §3.5). */
export const setPostMatchDoneSchema = z.object({
  event_id: z.string().uuid(),
  done: z.boolean(),
});

export type UpsertEvaluationInput = z.infer<typeof upsertEvaluationSchema>;
export type DeleteEvaluationInput = z.infer<typeof deleteEvaluationSchema>;
export type SetPostMatchDoneInput = z.infer<typeof setPostMatchDoneSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// F8.3 — Valoración COLECTIVA del partido (tabla team_evaluations, una por
// partido). Coexiste con la individual. A diferencia de la individual, `rating`
// es OBLIGATORIO (1-10): no hay valoración colectiva sin número.
// ─────────────────────────────────────────────────────────────────────────────

export const upsertTeamEvaluationSchema = z.object({
  event_id: z.string().uuid(),
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX),
  comment: commentField,
});

export const deleteTeamEvaluationSchema = z.object({
  event_id: z.string().uuid(),
});

export type UpsertTeamEvaluationInput = z.infer<typeof upsertTeamEvaluationSchema>;
export type DeleteTeamEvaluationInput = z.infer<typeof deleteTeamEvaluationSchema>;
