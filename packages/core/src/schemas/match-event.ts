/**
 * F7.3 — Schema Zod del registro de un evento sobre un jugador. Valida la forma
 * en el servidor antes de tocar la BD; los CHECK/triggers/RLS de 7.1 son la
 * última línea. `side`, `clock_seconds`, `period` y `display_minute` NO los
 * manda el cliente: los deriva el servidor del reloj (motor de 7.7).
 */

import { z } from 'zod';
import {
  FIELD_EVENT_TYPES,
  PLAYER_EVENT_TYPES,
  RIVAL_EVENT_TYPES,
} from '../match/event';

const uuid = z.string().uuid({ message: 'invalid_id' });
const pct = z
  .number()
  .min(0, { message: 'pct_range' })
  .max(100, { message: 'pct_range' });

export const registerPlayerEventSchema = z.object({
  event_id: uuid,
  // id generado en el cliente (UUID v4) → reintento idempotente (§10).
  id: uuid,
  type: z.enum(PLAYER_EVENT_TYPES as unknown as [string, ...string[]], {
    message: 'type_invalid',
  }),
  player_id: uuid,
});
export type RegisterPlayerEventInput = z.infer<typeof registerPlayerEventSchema>;

/**
 * F7.4 — evento sobre el CÉSPED (córner, falta, fuera de juego, tiro). Lleva
 * coordenadas (0–100) y no jugador. `side`/`clock_seconds`/`period`/
 * `display_minute` los deriva el servidor (igual que 7.3).
 */
export const registerFieldEventSchema = z.object({
  event_id: uuid,
  id: uuid,
  type: z.enum(FIELD_EVENT_TYPES as unknown as [string, ...string[]], {
    message: 'type_invalid',
  }),
  x_pct: pct,
  y_pct: pct,
});
export type RegisterFieldEventInput = z.infer<typeof registerFieldEventSchema>;

/**
 * F7.5 — sustitución: SALE `player_out_id`, ENTRA `player_in_id`. Se persiste
 * como match_event type='substitution'. El servidor valida que el que sale esté
 * en campo y el que entra sea elegible (no expulsado/ausente/ya entrado).
 */
export const registerSubstitutionSchema = z
  .object({
    event_id: uuid,
    id: uuid,
    player_out_id: uuid,
    player_in_id: uuid,
  })
  .refine((v) => v.player_out_id !== v.player_in_id, {
    message: 'same_player',
    path: ['player_in_id'],
  });
export type RegisterSubstitutionInput = z.infer<typeof registerSubstitutionSchema>;

/**
 * F7.5 — "quitar al que no viene": marca/desmarca a un convocado como AUSENTE
 * para este partido (reversible). Se persiste en match_absences.
 */
export const setAbsenceSchema = z.object({
  event_id: uuid,
  player_id: uuid,
  absent: z.boolean(),
});
export type SetAbsenceInput = z.infer<typeof setAbsenceSchema>;

/**
 * F7.6 — evento del RIVAL. El rival no tiene roster (§3.4): se identifica por
 * DORSAL (1–99) + nota libre opcional. `side='rival'`, sin jugador. Las
 * coordenadas (x/y) son OPCIONALES (eventos sobre el campo) y solo válidas para
 * los tipos de campo (córner/falta/fuera de juego/tiro); el trigger de 7.1 es la
 * última línea. `clock_seconds`/`period`/`display_minute` los deriva el servidor.
 */
export const registerRivalEventSchema = z.object({
  event_id: uuid,
  id: uuid,
  type: z.enum(RIVAL_EVENT_TYPES as unknown as [string, ...string[]], {
    message: 'type_invalid',
  }),
  rival_dorsal: z
    .number({ message: 'dorsal_range' })
    .int({ message: 'dorsal_range' })
    .min(1, { message: 'dorsal_range' })
    .max(99, { message: 'dorsal_range' }),
  // Nota libre opcional (hasta 200 chars); '' se trata como ausente.
  note: z.string().trim().max(200, { message: 'note_too_long' }).optional(),
  x_pct: pct.optional(),
  y_pct: pct.optional(),
});
export type RegisterRivalEventInput = z.infer<typeof registerRivalEventSchema>;

/**
 * F7.6b — mover a un jugador del campo a una nueva posición (x/y 0–100). La
 * nueva posición se guarda en el estado táctico vivo (match_state.live_positions).
 */
export const movePlayerSchema = z.object({
  event_id: uuid,
  player_id: uuid,
  x_pct: pct,
  y_pct: pct,
});
export type MovePlayerInput = z.infer<typeof movePlayerSchema>;

/**
 * F7.6b — cambiar la formación entera en directo. `formation_code` se valida
 * contra el catálogo de F6 (y la modalidad del equipo) en la server action.
 */
export const changeFormationSchema = z.object({
  event_id: uuid,
  formation_code: z.string().min(1, { message: 'formation_required' }).max(40),
});
export type ChangeFormationInput = z.infer<typeof changeFormationSchema>;
