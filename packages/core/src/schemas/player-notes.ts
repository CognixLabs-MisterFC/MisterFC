/**
 * F7 (mejora) — Schemas de las notas por jugador (player_notes).
 *
 * El servidor deriva club_id y author (auth.uid()) en el trigger; el cliente solo
 * manda player_id, el texto y, opcionalmente, el partido/equipo de origen.
 */

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'invalid_id' });

export const createPlayerNoteSchema = z.object({
  player_id: uuid,
  note: z
    .string()
    .trim()
    .min(1, { message: 'note_required' })
    .max(2000, { message: 'note_too_long' }),
  /** Partido de origen (cuando se crea desde /directo). Opcional. */
  match_event_id: uuid.optional(),
  /** Equipo en el momento de la nota. Opcional. */
  team_id: uuid.optional(),
});
export type CreatePlayerNoteInput = z.infer<typeof createPlayerNoteSchema>;

export const updatePlayerNoteSchema = z.object({
  id: uuid,
  note: z
    .string()
    .trim()
    .min(1, { message: 'note_required' })
    .max(2000, { message: 'note_too_long' }),
});
export type UpdatePlayerNoteInput = z.infer<typeof updatePlayerNoteSchema>;

export const deletePlayerNoteSchema = z.object({ id: uuid });
export type DeletePlayerNoteInput = z.infer<typeof deletePlayerNoteSchema>;
