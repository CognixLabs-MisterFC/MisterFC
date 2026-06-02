/**
 * F7.3 — Schema Zod del registro de un evento sobre un jugador. Valida la forma
 * en el servidor antes de tocar la BD; los CHECK/triggers/RLS de 7.1 son la
 * última línea. `side`, `clock_seconds`, `period` y `display_minute` NO los
 * manda el cliente: los deriva el servidor del reloj (motor de 7.7).
 */

import { z } from 'zod';
import { FIELD_EVENT_TYPES, PLAYER_EVENT_TYPES } from '../match/event';

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
