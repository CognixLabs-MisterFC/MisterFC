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

/** Rechazo (11.7): exige motivo no vacío (el trigger de 11.1 también lo exige). */
export const rejectExerciseSchema = z.object({
  id: z.string().uuid({ message: 'id_invalid' }),
  reason: z
    .string()
    .trim()
    .min(1, { message: 'reason_required' })
    .max(2000, { message: 'reason_too_long' }),
});

export type RejectExerciseInput = z.infer<typeof rejectExerciseSchema>;

/**
 * Estado objetivo al EDITAR, según el estado ACTUAL (defensa contra fugas del
 * ciclo de aprobación). Desde 'draft' el set completo (save_draft/propose/
 * publish-si-admin). Desde 'proposed' SOLO sigue propuesto ("Guardar cambios").
 * Desde 'rejected' el autor corrige y reprone: como 'draft' pero SIN publicar
 * (publish no aplica; aprobar es la acción del Admin, no la edición). 'published'
 * no es editable aquí. Aprobar/rechazar NO pasan por aquí (acciones dedicadas).
 */
export function statusForUpdate(
  current: MethodologyStatus,
  action: ExerciseFormAction,
  isAdmin: boolean
): MethodologyStatus | null {
  if (current === 'draft') return statusForAction(action, isAdmin);
  if (current === 'proposed') return action === 'propose' ? 'proposed' : null;
  if (current === 'rejected') return action === 'publish' ? null : statusForAction(action, false);
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

// ── Importar / exportar (11.8) ────────────────────────────────────────────────
/** Versión del envoltorio de exportación (independiente del contrato del diagrama). */
export const EXERCISE_EXPORT_VERSION = 1 as const;

/**
 * Envoltorio de import/export: SOLO contenido (sin id/owner/club/ciclo/timestamps).
 * El `exercise` se valida con el MISMO `exerciseFormSchema` (incluye `parseDiagram`
 * vía `diagramSchema`), así un import válido es exactamente un alta de borrador.
 */
export const exerciseExportSchema = z.object({
  version: z.literal(EXERCISE_EXPORT_VERSION),
  exercise: exerciseFormSchema,
});

export type ExerciseExport = z.infer<typeof exerciseExportSchema>;

/** Contenido de un ejercicio tal como llega de la ficha (campos nullable de BD). */
export type ExerciseExportContent = {
  name: string;
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  physical_focus: string | null;
  intensity: string | null;
  space_type: string | null;
  space_dimensions: string | null;
  base_duration: number | null;
  description: string | null;
  objective: string | null;
  coaching_points: string | null;
  variants: string | null;
  players: string | null;
  diagram: Diagram | null;
};

/**
 * Construye el JSON exportable: envoltorio versionado + SOLO contenido. Omite los
 * opcionales vacíos (null) para un JSON limpio; los arrays van siempre. El
 * resultado vuelve a pasar `exerciseFormSchema` (round-trip import).
 */
export function buildExerciseExport(content: ExerciseExportContent): ExerciseExport {
  const exercise: ExerciseFormInput = {
    name: content.name,
    categories: content.categories.filter((c): c is CategoryKind =>
      (CATEGORY_KINDS as readonly string[]).includes(c)
    ),
    tactical_objectives: content.tactical_objectives.filter((c) =>
      (TACTICAL_OBJECTIVES as readonly string[]).includes(c)
    ) as ExerciseFormInput['tactical_objectives'],
    technical_objectives: content.technical_objectives.filter((c) =>
      (TECHNICAL_OBJECTIVES as readonly string[]).includes(c)
    ) as ExerciseFormInput['technical_objectives'],
    ...(content.physical_focus != null ? { physical_focus: content.physical_focus } : {}),
    ...(content.intensity != null
      ? { intensity: content.intensity as ExerciseIntensity }
      : {}),
    ...(content.space_type != null
      ? { space_type: content.space_type as ExerciseSpaceType }
      : {}),
    ...(content.space_dimensions != null ? { space_dimensions: content.space_dimensions } : {}),
    ...(content.base_duration != null ? { base_duration: content.base_duration } : {}),
    ...(content.description != null ? { description: content.description } : {}),
    ...(content.objective != null ? { objective: content.objective } : {}),
    ...(content.coaching_points != null ? { coaching_points: content.coaching_points } : {}),
    ...(content.variants != null ? { variants: content.variants } : {}),
    ...(content.players != null ? { players: content.players } : {}),
    ...(content.diagram != null && content.diagram.elements.length > 0
      ? { diagram: content.diagram }
      : {}),
  };
  return { version: EXERCISE_EXPORT_VERSION, exercise };
}

/**
 * Valida un JSON importado (envoltorio + cada campo + diagrama). NO lanza:
 * devuelve el contenido validado o el error de zod. La capa de app lo da de alta
 * como borrador del importador.
 */
export function parseExerciseImport(input: unknown) {
  return exerciseExportSchema.safeParse(input);
}
