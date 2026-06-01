/**
 * F6.10 — Schemas de plantillas de formación personalizadas (coach_formations).
 *
 * `positions` es un array de objetos {position_code, x_pct, y_pct} en snake_case
 * (la misma forma que persiste el JSONB y valida el trigger de BD). El nº de
 * items debe coincidir con la modalidad: F7=7, F8=8, F11=11 (incluye portero).
 */

import { z } from 'zod';
import { startersFor } from '../lineups/rules';
import type { TeamFormat } from '../lineups/types';

export const COACH_FORMATION_FORMATS = ['F7', 'F8', 'F11'] as const;

/** Un hueco de la plantilla, tal cual se guarda en el JSONB. */
export const coachFormationPositionSchema = z.object({
  position_code: z
    .string()
    .trim()
    .min(1, { message: 'position_code_required' })
    .max(20, { message: 'position_code_too_long' }),
  x_pct: z
    .number()
    .min(0, { message: 'coord_out_of_range' })
    .max(100, { message: 'coord_out_of_range' }),
  y_pct: z
    .number()
    .min(0, { message: 'coord_out_of_range' })
    .max(100, { message: 'coord_out_of_range' }),
});

export type CoachFormationPosition = z.infer<typeof coachFormationPositionSchema>;

const nameSchema = z
  .string()
  .trim()
  .min(1, { message: 'name_required' })
  .max(60, { message: 'name_too_long' });

const formatSchema = z.enum(COACH_FORMATION_FORMATS, {
  message: 'format_invalid',
});

/**
 * Comprueba que el nº de posiciones cuadra con la modalidad. Se aplica como
 * superRefine sobre create/update para que el error salga ligado a `positions`.
 */
function refinePositionsCount(
  data: { format: TeamFormat; positions: CoachFormationPosition[] },
  ctx: z.RefinementCtx,
): void {
  const expected = startersFor(data.format);
  if (data.positions.length !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'positions_count_mismatch',
      path: ['positions'],
    });
  }
}

export const createCoachFormationSchema = z
  .object({
    name: nameSchema,
    format: formatSchema,
    positions: z.array(coachFormationPositionSchema),
  })
  .superRefine(refinePositionsCount);

export type CreateCoachFormationInput = z.infer<
  typeof createCoachFormationSchema
>;

export const updateCoachFormationSchema = z
  .object({
    id: z.string().uuid({ message: 'id_invalid' }),
    name: nameSchema,
    format: formatSchema,
    positions: z.array(coachFormationPositionSchema),
  })
  .superRefine(refinePositionsCount);

export type UpdateCoachFormationInput = z.infer<
  typeof updateCoachFormationSchema
>;

export const deleteCoachFormationSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
});

export type DeleteCoachFormationInput = z.infer<
  typeof deleteCoachFormationSchema
>;
