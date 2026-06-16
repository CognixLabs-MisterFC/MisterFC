/**
 * F11.6 — Esquema del FORMULARIO de ejercicio + lógica pura de guardado.
 *
 * Spec: docs/specs/11.0-biblioteca-ejercicios.md §4. SOLO `name` es obligatorio;
 * todo lo demás es opcional (incluido el diagrama). Las taxonomías validan contra
 * los vocabularios de `@misterfc/core` (mismo subconjunto que el CHECK de la
 * migración 11.1). El diagrama se valida con el MISMO `diagramSchema` (= la
 * validación autoritativa `parseDiagram`) usado en toda F11.
 *
 * Flujo A (borrador + proponer). La ACCIÓN del formulario (no el rol) decide el
 * estado objetivo; el rol solo limita qué acciones se ofrecen y la RLS/trigger de
 * 11.1 son el gate real:
 *   - save_draft → 'draft'     (entrenador)
 *   - propose    → 'proposed'  (entrenador)
 *   - publish    → 'published' (SOLO Admin; en otro caso null = no permitido)
 *
 * Convención: claves en inglés, valores de dominio en español. Puro: sin DOM, sin
 * BD, sin React.
 */

import { z } from 'zod';
import { diagramSchema, type Diagram } from '../diagram/diagram';
import {
  CATEGORY_KINDS,
  type CategoryKind,
} from '../schemas/club-structure';
import {
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  type ExerciseIntensity,
  type ExerciseSpaceType,
  type MethodologyStatus,
} from './exercises';

// ── Acciones de guardado del formulario ──────────────────────────────────────
export const EXERCISE_FORM_ACTIONS = ['save_draft', 'propose', 'publish'] as const;
export type ExerciseFormAction = (typeof EXERCISE_FORM_ACTIONS)[number];

/**
 * Estado objetivo según la acción del formulario. `publish` SOLO lo permite el
 * Admin (en otro caso devuelve null → la capa de app responde 'forbidden'; la
 * RLS/trigger de 11.1 lo bloquearían igualmente: defensa en profundidad).
 */
export function statusForAction(
  action: ExerciseFormAction,
  isAdmin: boolean
): MethodologyStatus | null {
  switch (action) {
    case 'save_draft':
      return 'draft';
    case 'propose':
      return 'proposed';
    case 'publish':
      return isAdmin ? 'published' : null;
    default:
      return null;
  }
}

// ── Primitivas del formulario ─────────────────────────────────────────────────
/** Texto opcional: '' (o solo espacios) → undefined; recorta y limita longitud. */
function optText(max: number) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max, { message: 'too_long' }).optional()
  );
}

const nameSchema = z
  .string()
  .trim()
  .min(1, { message: 'name_required' })
  .max(120, { message: 'name_too_long' });

/** Duración base en minutos: '' → undefined; coacciona string numérico a entero. */
const baseDurationSchema = z.preprocess(
  (v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  },
  z
    .number({ message: 'base_duration_invalid' })
    .int({ message: 'base_duration_invalid' })
    .min(0, { message: 'base_duration_invalid' })
    .max(600, { message: 'base_duration_invalid' })
    .optional()
);

// ── Esquema del formulario ────────────────────────────────────────────────────
export const exerciseFormSchema = z.object({
  name: nameSchema,
  description: optText(5000),
  objective: optText(2000),
  coaching_points: optText(5000),
  variants: optText(5000),
  players: optText(2000),
  categories: z.array(z.enum(CATEGORY_KINDS, { message: 'category_invalid' })).default([]),
  tactical_objectives: z
    .array(z.enum(TACTICAL_OBJECTIVES, { message: 'tactical_invalid' }))
    .default([]),
  technical_objectives: z
    .array(z.enum(TECHNICAL_OBJECTIVES, { message: 'technical_invalid' }))
    .default([]),
  physical_focus: optText(2000),
  intensity: z.enum(EXERCISE_INTENSITIES, { message: 'intensity_invalid' }).nullish(),
  space_type: z.enum(EXERCISE_SPACE_TYPES, { message: 'space_type_invalid' }).nullish(),
  space_dimensions: optText(60),
  base_duration: baseDurationSchema,
  // Diagrama opcional. Se valida con el contrato 11.0 (= parseDiagram). Una escena
  // vacía se normaliza a null en `toExerciseColumns` (no se persiste).
  diagram: diagramSchema.nullish(),
});

export type ExerciseFormInput = z.infer<typeof exerciseFormSchema>;

// El esquema de creación es el del formulario más la acción (que decide el estado).
export const createExerciseSchema = exerciseFormSchema.extend({
  action: z.enum(EXERCISE_FORM_ACTIONS, { message: 'action_invalid' }),
});

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

// El esquema de edición añade el id del ejercicio a editar.
export const updateExerciseSchema = createExerciseSchema.extend({
  id: z.string().uuid({ message: 'id_invalid' }),
});

export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;

/** Esquema mínimo de las acciones de ciclo de vida sin formulario
 *  (proponer-desde-ficha, borrar, archivar). */
export const exerciseIdSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
});

export type ExerciseIdInput = z.infer<typeof exerciseIdSchema>;

/**
 * Estado objetivo al EDITAR, según el estado ACTUAL (defensa contra fugas del
 * ciclo a 11.7). Desde 'draft' se permite el set completo (save_draft/propose/
 * publish-si-admin). Desde 'proposed' SOLO se puede seguir propuesto ("Guardar
 * cambios"); aquí el Admin NO aprueba/rechaza (eso es 11.7). Otros estados
 * (published/rejected) no son editables en esta subfase → null.
 */
export function statusForUpdate(
  current: MethodologyStatus,
  action: ExerciseFormAction,
  isAdmin: boolean
): MethodologyStatus | null {
  if (current === 'draft') return statusForAction(action, isAdmin);
  if (current === 'proposed') return action === 'propose' ? 'proposed' : null;
  return null;
}

// ── Mapeo a columnas de `exercises` ───────────────────────────────────────────
/** Columnas de la tabla `exercises` que escribe el formulario (sin auditoría). */
export type ExerciseColumns = {
  name: string;
  description: string | null;
  objective: string | null;
  coaching_points: string | null;
  variants: string | null;
  players: string | null;
  categories: CategoryKind[];
  tactical_objectives: string[];
  technical_objectives: string[];
  physical_focus: string | null;
  intensity: ExerciseIntensity | null;
  space_type: ExerciseSpaceType | null;
  space_dimensions: string | null;
  base_duration: number | null;
  diagram: Diagram | null;
  status: MethodologyStatus;
};

/** Un diagrama sin elementos no se persiste (la ficha lo omite igualmente). */
function normalizeDiagram(d: Diagram | null | undefined): Diagram | null {
  if (!d || d.elements.length === 0) return null;
  return d;
}

const orNull = <T>(v: T | undefined | null): T | null => (v == null ? null : v);

/**
 * Construye las columnas de `exercises` a partir de los datos validados del
 * formulario y un `status` ya resuelto. Puro y testeable: la auditoría
 * (owner/club/approved_*) la añade la capa de app.
 */
export function toExerciseColumns(
  data: ExerciseFormInput,
  status: MethodologyStatus
): ExerciseColumns {
  return {
    name: data.name,
    description: orNull(data.description),
    objective: orNull(data.objective),
    coaching_points: orNull(data.coaching_points),
    variants: orNull(data.variants),
    players: orNull(data.players),
    categories: data.categories,
    tactical_objectives: data.tactical_objectives,
    technical_objectives: data.technical_objectives,
    physical_focus: orNull(data.physical_focus),
    intensity: orNull(data.intensity),
    space_type: orNull(data.space_type),
    space_dimensions: orNull(data.space_dimensions),
    base_duration: orNull(data.base_duration),
    diagram: normalizeDiagram(data.diagram),
    status,
  };
}
