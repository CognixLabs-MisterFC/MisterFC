/**
 * F3 — Schemas Zod para eventos (spec 3.0 §6).
 */

import { z } from 'zod';
import { EVENT_TYPES } from '../events/types';

export const EVENT_TARGET_KINDS = ['team', 'category', 'club'] as const;

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const recurrenceRuleSchema = z
  .object({
    freq: z.literal('weekly'),
    interval: z.number().int().min(1).max(4),
    by_weekday: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7),
    // count = número de SEMANAS de la serie, no de hijos.
    count: z.number().int().min(1).max(52).optional(),
    until: z.string().regex(isoDateRegex).optional(),
  })
  .refine(
    (d) => (d.count != null) !== (d.until != null),
    { message: 'count_xor_until' }
  );
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;

const targetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('team'),
    team_id: z.string().uuid({ message: 'team_id_invalid' }),
  }),
  z.object({
    kind: z.literal('category'),
    category_id: z.string().uuid({ message: 'category_id_invalid' }),
  }),
  z.object({ kind: z.literal('club') }),
]);

export const eventInputSchema = z
  .object({
    type: z.enum(EVENT_TYPES, { message: 'type_invalid' }),
    target: targetSchema,
    title: z
      .string()
      .trim()
      .min(1, { message: 'title_required' })
      .max(200, { message: 'title_too_long' }),
    starts_at: z.string().datetime({ message: 'starts_at_invalid' }),
    ends_at: z
      .string()
      .datetime({ message: 'ends_at_invalid' })
      .nullable(),
    all_day: z.boolean(),
    location_name: z.string().trim().max(160).nullable(),
    location_address: z.string().trim().max(240).nullable(),
    opponent_name: z.string().trim().max(120).nullable(),
    notes: z.string().nullable(),
    recurrence_rule: recurrenceRuleSchema.nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.ends_at != null) {
      const s = Date.parse(d.starts_at);
      const e = Date.parse(d.ends_at);
      if (e < s) {
        ctx.addIssue({
          code: 'custom',
          path: ['ends_at'],
          message: 'ends_at_before_starts_at',
        });
      }
    }
    if (
      d.opponent_name != null &&
      d.opponent_name.length > 0 &&
      !(d.type === 'match' || d.type === 'friendly')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['opponent_name'],
        message: 'opponent_only_match_friendly',
      });
    }
  });
export type EventInput = z.infer<typeof eventInputSchema>;

/**
 * F13B — alta de un TORNEO. Crea en una sola acción la CABECERA
 * (evento `type='tournament'`, aloja la convocatoria única) + su 1er PARTIDO
 * (evento `type='match'`, `round=1`, `tournament_id`=cabecera). `title` es el
 * nombre del torneo; `starts_at`/`opponent_name`/`location_*` son los del 1er
 * cruce. El torneo es siempre de un EQUIPO (la convocatoria y el partido exigen
 * `team_id`), por eso se pide `team_id` directo y no el target genérico.
 */
export const tournamentInputSchema = z
  .object({
    team_id: z.string().uuid({ message: 'team_id_invalid' }),
    title: z
      .string()
      .trim()
      .min(1, { message: 'title_required' })
      .max(200, { message: 'title_too_long' }),
    starts_at: z.string().datetime({ message: 'starts_at_invalid' }),
    ends_at: z.string().datetime({ message: 'ends_at_invalid' }).nullable(),
    all_day: z.boolean(),
    location_name: z.string().trim().max(160).nullable(),
    location_address: z.string().trim().max(240).nullable(),
    opponent_name: z.string().trim().max(120).nullable(),
    notes: z.string().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.ends_at != null && Date.parse(d.ends_at) < Date.parse(d.starts_at)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'ends_at_before_starts_at',
      });
    }
  });
export type TournamentInput = z.infer<typeof tournamentInputSchema>;

export const updateEventModes = ['single', 'this_and_future', 'series'] as const;
export type UpdateEventMode = (typeof updateEventModes)[number];

export const deleteEventModes = ['single', 'this_and_future', 'series'] as const;
export type DeleteEventMode = (typeof deleteEventModes)[number];
