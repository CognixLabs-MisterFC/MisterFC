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
  PLAYER_FIELD_EVENT_TYPES,
  RIVAL_EVENT_TYPES,
} from '../match/event';
import { PENALTY_OUTCOMES, SHOOTOUT_OUTCOMES } from '../match/score';
import { FOUL_KINDS, CORNER_SIDES } from '../match/team-events';

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
 * F-bug captura — TIRO / FUERA DE JUEGO atribuidos AL JUGADOR (sin click en el
 * campo). Se registran tocando a nuestro jugador (como un gol): `side='own'`,
 * `player_id`, SIN coordenadas. No pasa por `registerPlayerEventSchema` porque
 * ese flujo aplica la lógica de tarjetas/expulsión (7.3) que aquí no toca. El
 * tiro con `player_id` es lo que permite a la consolidación materializar
 * `match_player_stats.shots` por jugador.
 */
export const registerPlayerFieldEventSchema = z.object({
  event_id: uuid,
  id: uuid,
  type: z.enum(PLAYER_FIELD_EVENT_TYPES as unknown as [string, ...string[]], {
    message: 'type_invalid',
  }),
  player_id: uuid,
});
export type RegisterPlayerFieldEventInput = z.infer<
  typeof registerPlayerFieldEventSchema
>;

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
 * F7.4b — FALTA detallada (sobre jugador + ubicación). `kind='committed'`: la
 * comete nuestro `player_id`; `kind='received'`: la recibe nuestro `player_id`
 * (la comete el rival). `side='own'`, `metadata.foul_kind`; `clock_seconds`/
 * `period`/`display_minute` los deriva el servidor. Las coordenadas (0–100) son
 * OPCIONALES: la falta se registra al TOCAR al jugador, sin click en el campo
 * (el CHECK `match_events_coords_field_only` admite coords nulas).
 */
export const registerFoulSchema = z.object({
  event_id: uuid,
  id: uuid,
  player_id: uuid,
  kind: z.enum(FOUL_KINDS as unknown as [string, ...string[]], {
    message: 'foul_kind_invalid',
  }),
  x_pct: pct.optional(),
  y_pct: pct.optional(),
});
export type RegisterFoulInput = z.infer<typeof registerFoulSchema>;

/**
 * F7.4b — CÓRNER con su bando: `corner_side='for'` (a favor) / `'against'` (en
 * contra). Sin jugador ni coordenadas. `side='own'`, `metadata.corner_side`.
 */
export const registerCornerSchema = z.object({
  event_id: uuid,
  id: uuid,
  corner_side: z.enum(CORNER_SIDES as unknown as [string, ...string[]], {
    message: 'corner_side_invalid',
  }),
});
export type RegisterCornerInput = z.infer<typeof registerCornerSchema>;

/**
 * F7.7c — PENALTI durante el partido sobre un jugador propio. Resultado en
 * `metadata.outcome` (marcado/parado/fuera). Un penalti marcado cuenta como gol
 * (no se registra un `goal` aparte). `side`/`clock_seconds`/`period`/
 * `display_minute` los deriva el servidor.
 */
export const registerPenaltySchema = z.object({
  event_id: uuid,
  id: uuid,
  player_id: uuid,
  outcome: z.enum(PENALTY_OUTCOMES as unknown as [string, ...string[]], {
    message: 'outcome_invalid',
  }),
});
export type RegisterPenaltyInput = z.infer<typeof registerPenaltySchema>;

/** F7.7c — PENALTI del RIVAL (por dorsal). Mismo outcome que el propio. */
export const registerRivalPenaltySchema = z.object({
  event_id: uuid,
  id: uuid,
  rival_dorsal: z
    .number({ message: 'dorsal_range' })
    .int({ message: 'dorsal_range' })
    .min(1, { message: 'dorsal_range' })
    .max(99, { message: 'dorsal_range' }),
  outcome: z.enum(PENALTY_OUTCOMES as unknown as [string, ...string[]], {
    message: 'outcome_invalid',
  }),
});
export type RegisterRivalPenaltyInput = z.infer<typeof registerRivalPenaltySchema>;

/**
 * F7.7c — lanzamiento de la TANDA de penaltis (desempate). De NUESTRO bando
 * (`player_id`) o del RIVAL (`rival_dorsal`), nunca ambos. Resultado
 * marcado/fallado. NO cuenta como gol del partido ni suma minutos.
 */
export const registerShootoutKickSchema = z
  .object({
    event_id: uuid,
    id: uuid,
    side: z.enum(['own', 'rival'], { message: 'side_invalid' }),
    player_id: uuid.optional(),
    rival_dorsal: z
      .number()
      .int()
      .min(1, { message: 'dorsal_range' })
      .max(99, { message: 'dorsal_range' })
      .optional(),
    outcome: z.enum(SHOOTOUT_OUTCOMES as unknown as [string, ...string[]], {
      message: 'outcome_invalid',
    }),
  })
  .refine(
    (v) =>
      v.side === 'own'
        ? v.player_id != null && v.rival_dorsal == null
        : v.rival_dorsal != null && v.player_id == null,
    { message: 'actor_side_mismatch', path: ['side'] },
  );
export type RegisterShootoutKickInput = z.infer<typeof registerShootoutKickSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// F7.9 — Línea de tiempo editable: borrar, cambiar minuto, cambiar jugador y
// añadir un evento olvidado. Todas mutan `match_events`; minutos/marcador/
// contadores/expulsiones se REDERIVAN de los eventos (no hay estado paralelo).
// El servidor sigue derivando los campos de tiempo (clock_seconds/period) del
// MINUTO elegido vía el motor del reloj; el cliente solo manda el minuto.
// ─────────────────────────────────────────────────────────────────────────────

const dorsalSchema = z
  .number({ message: 'dorsal_range' })
  .int({ message: 'dorsal_range' })
  .min(1, { message: 'dorsal_range' })
  .max(99, { message: 'dorsal_range' });

/** Minuto de marcador editable (coherente con el CHECK display_minute 0–130). */
const minuteSchema = z
  .number({ message: 'minute_range' })
  .int({ message: 'minute_range' })
  .min(0, { message: 'minute_range' })
  .max(130, { message: 'minute_range' });

/** F7.9 — borrar un evento de la línea de tiempo (por su id de cliente). */
export const deleteMatchEventSchema = z.object({ event_id: uuid, id: uuid });
export type DeleteMatchEventInput = z.infer<typeof deleteMatchEventSchema>;

/** F7.9 — reanclar un evento a otro MINUTO (el servidor recalcula clock/period). */
export const updateEventMinuteSchema = z.object({
  event_id: uuid,
  id: uuid,
  display_minute: minuteSchema,
});
export type UpdateEventMinuteInput = z.infer<typeof updateEventMinuteSchema>;

/**
 * F7.9 — cambiar el ACTOR de un evento: jugador propio (`player_id`), dorsal
 * rival (`rival_dorsal`) o, en una sustitución, el que sale (`player_id`) y/o el
 * que entra (`related_player_id`). El servidor lee la fila para aplicar solo los
 * campos coherentes con el `side`/`type` (no viola los CHECK actor_by_side).
 */
export const updateEventActorSchema = z
  .object({
    event_id: uuid,
    id: uuid,
    player_id: uuid.optional(),
    related_player_id: uuid.optional(),
    rival_dorsal: dorsalSchema.optional(),
  })
  .refine(
    (v) =>
      v.player_id != null || v.related_player_id != null || v.rival_dorsal != null,
    { message: 'actor_required' },
  );
export type UpdateEventActorInput = z.infer<typeof updateEventActorSchema>;

/**
 * F7.9 — AÑADIR un evento olvidado en un minuto dado. Tipos soportados (los de
 * actor claro + faltas/córners; las sustituciones, cambios de formación y la
 * tanda tienen su propia UI y NO se dan de alta aquí). Reglas por tipo:
 *   - goal/assist/yellow_card/red_card: propio → `player_id`; rival → `rival_dorsal`.
 *     (`assist` solo propio.)
 *   - penalty: propio → `player_id`; rival → `rival_dorsal`; requiere `outcome`.
 *   - foul: SIEMPRE propio; requiere `player_id` + `foul_kind`; coords opcionales.
 *   - corner: SIEMPRE propio; requiere `corner_side`.
 *   - offside/shot: propio (por ubicación, coords opcionales, sin jugador) o
 *     rival (`rival_dorsal`).
 */
export const TIMELINE_ADD_TYPES = [
  'goal',
  'assist',
  'yellow_card',
  'red_card',
  'penalty',
  'foul',
  'corner',
  'offside',
  'shot',
] as const;

export const addTimelineEventSchema = z
  .object({
    event_id: uuid,
    id: uuid,
    side: z.enum(['own', 'rival'], { message: 'side_invalid' }),
    type: z.enum(TIMELINE_ADD_TYPES as unknown as [string, ...string[]], {
      message: 'type_invalid',
    }),
    display_minute: minuteSchema,
    player_id: uuid.optional(),
    rival_dorsal: dorsalSchema.optional(),
    outcome: z
      .enum(PENALTY_OUTCOMES as unknown as [string, ...string[]], {
        message: 'outcome_invalid',
      })
      .optional(),
    foul_kind: z
      .enum(FOUL_KINDS as unknown as [string, ...string[]], {
        message: 'foul_kind_invalid',
      })
      .optional(),
    corner_side: z
      .enum(CORNER_SIDES as unknown as [string, ...string[]], {
        message: 'corner_side_invalid',
      })
      .optional(),
    x_pct: pct.optional(),
    y_pct: pct.optional(),
    note: z.string().trim().max(200, { message: 'note_too_long' }).optional(),
  })
  .superRefine((v, ctx) => {
    const ownActor = ['goal', 'assist', 'yellow_card', 'red_card'];
    if (v.type === 'corner') {
      if (v.side !== 'own')
        ctx.addIssue({ code: 'custom', message: 'corner_own_only', path: ['side'] });
      if (!v.corner_side)
        ctx.addIssue({ code: 'custom', message: 'corner_side_required', path: ['corner_side'] });
      return;
    }
    if (v.type === 'foul') {
      if (v.side !== 'own')
        ctx.addIssue({ code: 'custom', message: 'foul_own_only', path: ['side'] });
      if (!v.player_id)
        ctx.addIssue({ code: 'custom', message: 'player_required', path: ['player_id'] });
      if (!v.foul_kind)
        ctx.addIssue({ code: 'custom', message: 'foul_kind_required', path: ['foul_kind'] });
      return;
    }
    if (v.type === 'penalty') {
      if (!v.outcome)
        ctx.addIssue({ code: 'custom', message: 'outcome_required', path: ['outcome'] });
    }
    if (v.type === 'assist' && v.side !== 'own') {
      ctx.addIssue({ code: 'custom', message: 'assist_own_only', path: ['side'] });
    }
    // Actor coherente con el bando para los tipos con actor.
    const needsActor =
      ownActor.includes(v.type) || v.type === 'penalty' || v.type === 'offside' || v.type === 'shot';
    if (needsActor) {
      if (v.side === 'own') {
        // offside/shot propios van por UBICACIÓN (sin jugador); el resto sí lo exigen.
        const fieldByLocation = v.type === 'offside' || v.type === 'shot';
        if (!fieldByLocation && !v.player_id)
          ctx.addIssue({ code: 'custom', message: 'player_required', path: ['player_id'] });
      } else if (!v.rival_dorsal) {
        ctx.addIssue({ code: 'custom', message: 'dorsal_required', path: ['rival_dorsal'] });
      }
    }
  });
export type AddTimelineEventInput = z.infer<typeof addTimelineEventSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// F7.11 — Rivales destacados + notas del partido (solo de ESTE partido).
//   upsertRivalHighlight — destacar un dorsal rival (1–99) con una nota libre
//                          (añadir/editar; upsert por (event_id, dorsal)).
//   deleteRivalHighlight — quitar el destacado de un dorsal.
//   setMatchNotes        — notas generales del partido (match_state.post_match_notes).
// ─────────────────────────────────────────────────────────────────────────────

export const upsertRivalHighlightSchema = z.object({
  event_id: uuid,
  dorsal: dorsalSchema,
  // Lo que destaca (rápido, duro, peligroso…); 1–200 chars, '' no vale.
  note: z
    .string()
    .trim()
    .min(1, { message: 'note_required' })
    .max(200, { message: 'note_too_long' }),
});
export type UpsertRivalHighlightInput = z.infer<typeof upsertRivalHighlightSchema>;

export const deleteRivalHighlightSchema = z.object({
  event_id: uuid,
  dorsal: dorsalSchema,
});
export type DeleteRivalHighlightInput = z.infer<typeof deleteRivalHighlightSchema>;

export const setMatchNotesSchema = z.object({
  event_id: uuid,
  // Notas libres del partido; '' borra (queda en null). Hasta 4000 (CHECK 7.1).
  notes: z.string().trim().max(4000, { message: 'notes_too_long' }),
});
export type SetMatchNotesInput = z.infer<typeof setMatchNotesSchema>;

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
  // id de cliente (UUID) → el cambio se persiste como match_event idempotente.
  id: uuid,
  formation_code: z.string().min(1, { message: 'formation_required' }).max(40),
});
export type ChangeFormationInput = z.infer<typeof changeFormationSchema>;
