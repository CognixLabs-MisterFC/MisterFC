import { z } from 'zod';

/**
 * F4.3 — Schemas y constantes de convocatoria de partido.
 *
 * Tres modelos diferenciados (ver ADR-0007 y spec 4.0 §D3):
 *   - match_callup_meta : datos de citación + estado borrador/publicado.
 *   - callup_responses  : respuesta del jugador / familia (yes/maybe/no).
 *   - callup_decisions  : decisión técnica del cuerpo técnico
 *                         (called_up / discarded).
 *
 * Los enums replican literalmente los enums SQL para que sirvan como
 * contrato shared con F8/F9.
 */

export const TRANSPORT_MODES = ['club', 'individual', 'mixed'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const CALLUP_RESPONSE_STATUSES = ['yes', 'maybe', 'no'] as const;
export type CallupResponseStatus = (typeof CALLUP_RESPONSE_STATUSES)[number];

export const CALLUP_DECISION_KINDS = ['called_up', 'discarded'] as const;
export type CallupDecisionKind = (typeof CALLUP_DECISION_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// match_callup_meta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input para publicar (o guardar borrador) los datos de citación de un
 * partido. `published` controla si se publica al equipo o queda en
 * borrador para el cuerpo técnico.
 */
export const publishCallupSchema = z
  .object({
    event_id: z.string().uuid({ message: 'event_invalid' }),
    meeting_at: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), {
        message: 'meeting_at_invalid',
      }),
    meeting_location: z
      .string()
      .trim()
      .min(1, { message: 'meeting_location_required' })
      .max(200, { message: 'meeting_location_too_long' }),
    meeting_address: z
      .string()
      .max(300, { message: 'meeting_address_too_long' })
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null) return null;
        const t = v.trim();
        return t.length === 0 ? null : t;
      }),
    transport_mode: z
      .enum(TRANSPORT_MODES, { message: 'transport_mode_invalid' })
      .optional()
      .nullable(),
    transport_notes: z
      .string()
      .max(500, { message: 'transport_notes_too_long' })
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null) return null;
        const t = v.trim();
        return t.length === 0 ? null : t;
      }),
    notes_general: z
      .string()
      .max(1000, { message: 'notes_general_too_long' })
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null) return null;
        const t = v.trim();
        return t.length === 0 ? null : t;
      }),
    publish: z.boolean().default(false),
  });
export type PublishCallupInput = z.infer<typeof publishCallupSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// callup_responses
// ─────────────────────────────────────────────────────────────────────────────

export const upsertCallupResponseSchema = z.object({
  event_id: z.string().uuid({ message: 'event_invalid' }),
  player_id: z.string().uuid({ message: 'player_invalid' }),
  status: z.enum(CALLUP_RESPONSE_STATUSES, { message: 'status_invalid' }),
  reason: z
    .string()
    .max(500, { message: 'reason_too_long' })
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    }),
});
export type UpsertCallupResponseInput = z.infer<
  typeof upsertCallupResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// callup_decisions
// ─────────────────────────────────────────────────────────────────────────────

export const upsertCallupDecisionSchema = z.object({
  event_id: z.string().uuid({ message: 'event_invalid' }),
  player_id: z.string().uuid({ message: 'player_invalid' }),
  decision: z.enum(CALLUP_DECISION_KINDS, { message: 'decision_invalid' }),
  reason: z
    .string()
    .max(500, { message: 'reason_too_long' })
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    }),
});
export type UpsertCallupDecisionInput = z.infer<
  typeof upsertCallupDecisionSchema
>;
