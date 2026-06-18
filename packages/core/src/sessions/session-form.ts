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
