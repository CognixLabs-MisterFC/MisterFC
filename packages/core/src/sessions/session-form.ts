/**
 * F12 — Esquemas Zod del planificador de sesiones (validación canónica en core).
 *
 * Spec: docs/specs/12.0-planificador-sesiones.md §4 (D7/D8). Los objetivos de la
 * cabecera VALIDAN contra los MISMOS vocabularios que `exercises` (F11): así no se
 * duplica el enum literal en el SQL — la migración 12.1 usa CHECKs ligeros y la
 * validación AUTORITATIVA es esta capa (como en F11.6 con el diagrama).
 *
 * 12.1 fija las primitivas (objetivos, tipo de bloque, override del día,
 * cabecera). El formulario COMPLETO del editor (cabecera + bloques + picker +
 * reordenar) lo arma 12.2 sobre estas piezas.
 *
 * Convención: claves en inglés, valores de dominio en español. Puro: sin DOM, sin
 * BD, sin React.
 */

import { z } from 'zod';
import { TACTICAL_OBJECTIVES, TECHNICAL_OBJECTIVES } from '../exercises/exercises';
import { SESSION_BLOCK_TYPES, SESSION_VISIBILITIES } from './sessions';

// ── Primitivas ────────────────────────────────────────────────────────────────
/** Texto opcional: '' (o solo espacios) → undefined; recorta y limita longitud. */
function optText(max: number) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max, { message: 'too_long' }).optional()
  );
}

/** Minutos opcionales (≥0): '' → undefined; coacciona string numérico a entero. */
const minutesSchema = z.preprocess(
  (v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  },
  z
    .number({ message: 'minutes_invalid' })
    .int({ message: 'minutes_invalid' })
    .min(0, { message: 'minutes_invalid' })
    .max(600, { message: 'minutes_invalid' })
    .optional()
);

// ── Enums reutilizables ───────────────────────────────────────────────────────
export const sessionBlockTypeSchema = z.enum(SESSION_BLOCK_TYPES, {
  message: 'block_type_invalid',
});
export const sessionVisibilitySchema = z.enum(SESSION_VISIBILITIES, {
  message: 'visibility_invalid',
});

/** Objetivos de la cabecera — MISMO vocabulario que exercises (D8). */
const tacticalObjectivesSchema = z
  .array(z.enum(TACTICAL_OBJECTIVES, { message: 'tactical_invalid' }))
  .default([]);
const technicalObjectivesSchema = z
  .array(z.enum(TECHNICAL_OBJECTIVES, { message: 'technical_invalid' }))
  .default([]);

// ── Cabecera de la sesión (D7/D8) ─────────────────────────────────────────────
// Una sesión REAL tiene fecha; una plantilla (is_template) no (D5). El editor
// (12.2) resuelve la coherencia template↔fecha al construir el payload; aquí la
// fecha es opcional para cubrir ambos casos. El CHECK de la migración es el gate
// duro de esa coherencia.
export const sessionHeaderSchema = z.object({
  title: optText(120),
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_invalid' })
    .nullish(),
  objective_physical: optText(2000),
  tactical_objectives: tacticalObjectivesSchema,
  technical_objectives: technicalObjectivesSchema,
  mesocycle: optText(200),
  microcycle: optText(200),
  total_minutes: minutesSchema,
  visibility: sessionVisibilitySchema.default('staff'),
});

export type SessionHeaderInput = z.infer<typeof sessionHeaderSchema>;

// ── Tarea del bloque: ejercicio + OVERRIDE DEL DÍA (no va en el ejercicio) ─────
// Duración/series/notas son del día (spec 11.0 §339): el mismo ejercicio puede ir
// "18 min" en una sesión y "2 x 8'" en otra.
export const sessionTaskSchema = z.object({
  exercise_id: z.string().uuid({ message: 'exercise_id_invalid' }),
  duration_min: minutesSchema,
  series: optText(60),
  notes: optText(2000),
});

export type SessionTaskInput = z.infer<typeof sessionTaskSchema>;

// ── Bloque (tipo + título/notas opcionales + sus tareas) ──────────────────────
export const sessionBlockSchema = z.object({
  block_type: sessionBlockTypeSchema,
  title: optText(120),
  notes: optText(2000),
  tasks: z.array(sessionTaskSchema).default([]),
});

export type SessionBlockInput = z.infer<typeof sessionBlockSchema>;

// ── Crear sesión (12.2) ───────────────────────────────────────────────────────
// El alta es mínima: equipo destino (opcional) y fecha (opcional → la capa de app
// la fija a hoy). La cabecera se rellena después en el editor. La SIEMBRA del
// esqueleto la hace la capa de app con buildDefaultSkeleton().
const teamIdSchema = z.string().uuid({ message: 'team_id_invalid' }).nullish();

export const createSessionSchema = z.object({
  team_id: teamIdSchema,
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_invalid' })
    .nullish(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// ── Editar cabecera (12.2) ────────────────────────────────────────────────────
// Cabecera + id + team_id. NO incluye `visibility` (publicar = 12.4) ni
// `total_minutes` (desde 12.2b es DERIVADO de la suma de duration_min vía trigger).
export const updateSessionHeaderSchema = sessionHeaderSchema
  .omit({ visibility: true, total_minutes: true })
  .extend({
    id: z.string().uuid({ message: 'id_invalid' }),
    team_id: teamIdSchema,
  });

export type UpdateSessionHeaderInput = z.infer<typeof updateSessionHeaderSchema>;

// ── Publicar / despublicar al equipo (12.4) ────────────────────────────────────
// `visibility` se cambia con su PROPIA acción (no en la cabecera): publicar es una
// intención distinta de editar campos, con efecto inmediato (D3/D7). 'staff' =
// borrador (default); 'team' = visible read-only para jugadores y familias del
// team_id. El gate (owner∪admin) es la RLS de UPDATE de 12.1.
export const setSessionVisibilitySchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
  visibility: sessionVisibilitySchema,
});
export type SetSessionVisibilityInput = z.infer<typeof setSessionVisibilitySchema>;

/** Columnas de `sessions` que escribe la cabecera (sin auditoría, ciclo ni total). */
export type SessionHeaderColumns = {
  team_id: string | null;
  session_date: string | null;
  title: string | null;
  objective_physical: string | null;
  tactical_objectives: string[];
  technical_objectives: string[];
  mesocycle: string | null;
  microcycle: string | null;
};

const orNull = <T>(v: T | undefined | null): T | null => (v == null ? null : v);

/**
 * Mapea los datos validados de la cabecera a las columnas de `sessions`. Puro y
 * testeable: la auditoría (owner/club/updated_at) la añade el trigger/capa de app.
 * No toca `is_template`, `visibility` ni `total_minutes` (derivado por trigger).
 */
export function toSessionHeaderColumns(
  data: UpdateSessionHeaderInput
): SessionHeaderColumns {
  return {
    team_id: orNull(data.team_id),
    session_date: orNull(data.session_date),
    title: orNull(data.title),
    objective_physical: orNull(data.objective_physical),
    tactical_objectives: data.tactical_objectives,
    technical_objectives: data.technical_objectives,
    mesocycle: orNull(data.mesocycle),
    microcycle: orNull(data.microcycle),
  };
}

// ── Tareas del bloque (12.2b) ─────────────────────────────────────────────────
/** Añadir un ejercicio a un bloque (overrides del día vacíos por defecto). */
export const addBlockTaskSchema = z.object({
  block_id: z.string().uuid({ message: 'block_id_invalid' }),
  exercise_id: z.string().uuid({ message: 'exercise_id_invalid' }),
});
export type AddBlockTaskInput = z.infer<typeof addBlockTaskSchema>;

/** Editar los overrides del día de una tarea (duración/series/notas). */
export const updateBlockTaskSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
  duration_min: minutesSchema,
  series: optText(60),
  notes: optText(2000),
});
export type UpdateBlockTaskInput = z.infer<typeof updateBlockTaskSchema>;

/** Columnas de override del día de `session_block_exercises`. */
export type TaskOverrideColumns = {
  duration_min: number | null;
  series: string | null;
  notes: string | null;
};

export function toTaskOverrideColumns(data: UpdateBlockTaskInput): TaskOverrideColumns {
  return {
    duration_min: orNull(data.duration_min),
    series: orNull(data.series),
    notes: orNull(data.notes),
  };
}

/** Quitar una tarea de un bloque. */
export const blockTaskIdSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
});
export type BlockTaskIdInput = z.infer<typeof blockTaskIdSchema>;

// ── Reordenar (12.2b) ─────────────────────────────────────────────────────────
const uuidArray = z.array(z.string().uuid({ message: 'id_invalid' })).min(1, { message: 'empty' });

export const reorderBlocksSchema = z.object({
  session_id: z.string().uuid({ message: 'session_id_invalid' }),
  block_ids: uuidArray,
});
export type ReorderBlocksInput = z.infer<typeof reorderBlocksSchema>;

export const reorderTasksSchema = z.object({
  block_id: z.string().uuid({ message: 'block_id_invalid' }),
  task_ids: uuidArray,
});
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;

/** Mover una tarea a otro bloque (misma sesión) + orden final del destino. */
export const moveTaskSchema = z.object({
  task_id: z.string().uuid({ message: 'task_id_invalid' }),
  to_block_id: z.string().uuid({ message: 'block_id_invalid' }),
  dest_ids: uuidArray,
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

// ── Plantillas (12.6 — D5) ────────────────────────────────────────────────────
// Clonado vía el RPC clone_session (atómico). Dos direcciones, dos schemas:
//   · GUARDAR COMO PLANTILLA: nombre obligatorio (la plantilla SÍ se identifica por
//     su título); el clon se crea con is_template=true, sin fecha/equipo.
//   · CREAR DESDE PLANTILLA: equipo (opcional) + fecha (opcional → hoy en la capa de
//     app); el clon se crea con is_template=false. NO siembra el esqueleto (D5).

/** Guardar la sesión actual como plantilla (nombre requerido). */
export const saveAsTemplateSchema = z.object({
  source_id: z.string().uuid({ message: 'source_id_invalid' }),
  title: z.string().trim().min(1, { message: 'title_required' }).max(120, { message: 'too_long' }),
});
export type SaveAsTemplateInput = z.infer<typeof saveAsTemplateSchema>;

/** Crear una sesión real desde una plantilla (elige equipo + fecha). */
export const createFromTemplateSchema = z.object({
  template_id: z.string().uuid({ message: 'template_id_invalid' }),
  team_id: teamIdSchema,
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_invalid' })
    .nullish(),
});
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;

/** Borrar una plantilla (o sesión) por id. */
export const sessionIdSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
});
export type SessionIdInput = z.infer<typeof sessionIdSchema>;

/**
 * Suma de los minutos del día de un conjunto de tareas (cabecera = total
 * derivado). Ignora los `null`. Devuelve `null` si no hay ningún minuto (para
 * mostrar "—" en vez de 0). Espeja el trigger SQL session_recompute_total.
 */
export function sumTaskMinutes(durations: ReadonlyArray<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const d of durations) {
    if (typeof d === 'number') {
      total += d;
      any = true;
    }
  }
  return any ? total : null;
}
