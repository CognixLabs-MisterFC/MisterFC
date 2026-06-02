/**
 * F7.7 — Schemas Zod de las server actions del reloj del partido. Validan en el
 * servidor antes de tocar la BD; los CHECK/RLS de 7.1 son la última línea.
 */

import { z } from 'zod';
import { PERIOD_ORDER } from '../match/clock';

const uuid = z.string().uuid({ message: 'invalid_id' });

/** Solo el id del partido (events.id): iniciar, pausar, reanudar, terminar parte. */
export const matchEventRefSchema = z.object({ event_id: uuid });
export type MatchEventRefInput = z.infer<typeof matchEventRefSchema>;

/** Empezar el siguiente periodo (2ª parte, prórroga…). */
export const startNextPeriodSchema = z.object({
  event_id: uuid,
  period: z.enum(PERIOD_ORDER as unknown as [string, ...string[]], {
    message: 'period_invalid',
  }),
});
export type StartNextPeriodInput = z.infer<typeof startNextPeriodSchema>;

/**
 * Ajuste manual del reloj: ±delta en segundos. Tope ±90 min para evitar
 * ajustes accidentales absurdos; el reloj nunca baja de 0 (lo garantiza el
 * motor + el constraint accumulated >= 0).
 */
export const adjustClockSchema = z.object({
  event_id: uuid,
  delta_seconds: z
    .number()
    .int({ message: 'delta_int' })
    .min(-5400, { message: 'delta_range' })
    .max(5400, { message: 'delta_range' })
    .refine((d) => d !== 0, { message: 'delta_nonzero' }),
});
export type AdjustClockInput = z.infer<typeof adjustClockSchema>;
