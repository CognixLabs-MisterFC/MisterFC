/**
 * F6 — Schemas Zod de alineaciones (validación de los server actions). El
 * modelo y los CHECK de BD son la última línea; estos schemas validan en el
 * servidor antes de tocar la BD (no confiar solo en los constraints).
 */

import { z } from 'zod';
import { getFormation } from '../lineups/formations';
import { LINEUP_LOCATIONS } from '../lineups/types';

const uuid = z.string().uuid({ message: 'invalid_id' });

const formationCode = z
  .string()
  .min(1)
  .max(40)
  .refine((c) => getFormation(c) !== undefined, { message: 'formation_unknown' });

// F6.10 — al adoptar una plantilla del entrenador, formation_code guarda el
// uuid de coach_formations (cabe en char_length ≤ 40, no es FK). Aceptamos un
// code del catálogo O un uuid; la existencia de la coach_formation la garantiza
// la RLS de lineups + que el editor solo ofrece las del propio coach.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formationCodeOrCoachId = z
  .string()
  .min(1)
  .max(40)
  .refine((c) => getFormation(c) !== undefined || UUID_RE.test(c), {
    message: 'formation_unknown',
  });

export const createLineupSchema = z.object({
  event_id: uuid,
  name: z.string().trim().min(1, { message: 'name_required' }).max(60, { message: 'name_too_long' }),
  formation_code: formationCode,
  is_official: z.boolean().optional().default(false),
});
export type CreateLineupInput = z.infer<typeof createLineupSchema>;

export const setLineupFormationSchema = z.object({
  lineup_id: uuid,
  formation_code: formationCodeOrCoachId,
});
export type SetLineupFormationInput = z.infer<typeof setLineupFormationSchema>;

export const renameLineupSchema = z.object({
  lineup_id: uuid,
  name: z.string().trim().min(1, { message: 'name_required' }).max(60, { message: 'name_too_long' }),
});
export type RenameLineupInput = z.infer<typeof renameLineupSchema>;

export const setLineupOfficialSchema = z.object({
  lineup_id: uuid,
  is_official: z.boolean(),
});
export type SetLineupOfficialInput = z.infer<typeof setLineupOfficialSchema>;

export const deleteLineupPositionSchema = z.object({
  lineup_id: uuid,
  player_id: uuid,
});
export type DeleteLineupPositionInput = z.infer<typeof deleteLineupPositionSchema>;

export const setLineupVisibilitySchema = z.object({
  lineup_id: uuid,
  visibility: z.enum(['staff', 'team'], { message: 'visibility_invalid' }),
});
export type SetLineupVisibilityInput = z.infer<typeof setLineupVisibilitySchema>;

export const setTacticalNotesSchema = z.object({
  lineup_id: uuid,
  notes: z
    .string()
    .max(2000, { message: 'notes_too_long' })
    .nullable()
    .transform((v) => (v != null && v.trim().length === 0 ? null : v)),
});
export type SetTacticalNotesInput = z.infer<typeof setTacticalNotesSchema>;

export const createPlannedSubSchema = z
  .object({
    lineup_id: uuid,
    minute_planned: z.number().int().min(0, { message: 'minute_invalid' }).max(120, { message: 'minute_invalid' }),
    player_out_id: uuid,
    player_in_id: uuid,
    position_code_target: z.string().min(1).max(20).nullable().optional().default(null),
  })
  .refine((v) => v.player_out_id !== v.player_in_id, {
    message: 'same_player',
    path: ['player_in_id'],
  });
export type CreatePlannedSubInput = z.infer<typeof createPlannedSubSchema>;

export const deletePlannedSubSchema = z.object({ id: uuid });
export type DeletePlannedSubInput = z.infer<typeof deletePlannedSubSchema>;

/**
 * Upsert de la posición de un jugador. Las refinements replican los CHECK de
 * BD (coherencia location ↔ position_code / coords) para fallar temprano con un
 * mensaje claro en vez de un error de constraint genérico. Rediseño Lote B':
 * solo field/bench, sin out_reason.
 */
export const upsertLineupPositionSchema = z
  .object({
    lineup_id: uuid,
    player_id: uuid,
    location: z.enum(LINEUP_LOCATIONS, { message: 'location_invalid' }),
    position_code: z.string().min(1).max(20).nullable().optional().default(null),
    x_pct: z.number().min(0).max(100).nullable().optional().default(null),
    y_pct: z.number().min(0).max(100).nullable().optional().default(null),
  })
  .refine(
    (v) =>
      v.location === 'field' ? v.position_code != null : v.position_code == null,
    { message: 'position_code_coherence', path: ['position_code'] },
  )
  .refine(
    (v) => v.location === 'field' || (v.x_pct == null && v.y_pct == null),
    { message: 'coords_only_field', path: ['x_pct'] },
  );
export type UpsertLineupPositionInput = z.infer<typeof upsertLineupPositionSchema>;
