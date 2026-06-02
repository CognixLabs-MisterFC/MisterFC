/**
 * F7.3 — Schema Zod del registro de un evento sobre un jugador. Valida la forma
 * en el servidor antes de tocar la BD; los CHECK/triggers/RLS de 7.1 son la
 * última línea. `side`, `clock_seconds`, `period` y `display_minute` NO los
 * manda el cliente: los deriva el servidor del reloj (motor de 7.7).
 */

import { z } from 'zod';
import { PLAYER_EVENT_TYPES } from '../match/event';

const uuid = z.string().uuid({ message: 'invalid_id' });

export const registerPlayerEventSchema = z.object({
  event_id: uuid,
  // id generado en el cliente (UUID v4) → reintento idempotente (§10).
  id: uuid,
  type: z.enum(PLAYER_EVENT_TYPES as unknown as [string, ...string[]], {
    message: 'type_invalid',
  }),
  player_id: uuid,
  // id para la roja AUTOMÁTICA de doble amarilla (si aplica): el cliente lo
  // genera para reconciliar su fila optimista con la del servidor. Opcional;
  // el servidor decide de forma autoritativa si la crea.
  auto_red_id: uuid.optional(),
});
export type RegisterPlayerEventInput = z.infer<typeof registerPlayerEventSchema>;
