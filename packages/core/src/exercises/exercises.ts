/**
 * F11 — Vocabularios y estados de la biblioteca de ejercicios (constantes puras).
 *
 * Spec: docs/specs/11.0-biblioteca-ejercicios.md §4.4 / §4.7. Fuente de verdad
 * de los VALORES (en español) que también lista el CHECK/validación de la
 * migración 11.1 y que consumirán los Zod de los formularios (11.6). Mantener en
 * sync con la migración `exercises`.
 *
 * Convención: claves en inglés, VALORES de dominio en español (sin traducir; la
 * etiqueta visible se localiza vía i18n).
 */

// ── Objetivos tácticos (eje 1, multi-valor) ──────────────────────────────────
export const TACTICAL_OBJECTIVES = [
  'posesion',
  'salida_de_balon',
  'progresion',
  'ocupacion_del_espacio',
  'lineas_de_pase',
  'cambio_de_orientacion',
  'superioridad',
  'apoyos_y_desmarques',
  'accion_combinativa',
  'amplitud_y_profundidad',
  'juego_por_bandas',
  'centros',
  'finalizacion',
  'presion_tras_perdida',
  'repliegue',
  'basculacion',
  'coberturas_y_vigilancias',
  'transicion_ofensiva',
  'transicion_defensiva',
  'balon_parado',
] as const;
export type TacticalObjective = (typeof TACTICAL_OBJECTIVES)[number];

// ── Objetivos técnicos (eje 2, multi-valor) ──────────────────────────────────
export const TECHNICAL_OBJECTIVES = [
  'control',
  'pase',
  'recepcion',
  'conduccion',
  'regate',
  'golpeo',
  'tiro',
  'cabeceo',
] as const;
export type TechnicalObjective = (typeof TECHNICAL_OBJECTIVES)[number];

// ── Intensidad (opcional) ────────────────────────────────────────────────────
export const EXERCISE_INTENSITIES = ['baja', 'media', 'alta'] as const;
export type ExerciseIntensity = (typeof EXERCISE_INTENSITIES)[number];

// ── Espacio (cualitativo) ────────────────────────────────────────────────────
export const EXERCISE_SPACE_TYPES = [
  'campo_completo',
  'medio_campo',
  'cuarto_campo',
  'reducido',
] as const;
export type ExerciseSpaceType = (typeof EXERCISE_SPACE_TYPES)[number];

// ── Ciclo de metodología del club (estados) ──────────────────────────────────
// Reutilizable por F12 (plantillas de sesión): borrador → propuesto →
// publicado/rechazado (+ archivado vía archived_at). La aprobación la gatea el
// rol Admin del club (no una capability).
export const METHODOLOGY_STATUSES = ['draft', 'proposed', 'published', 'rejected'] as const;
export type MethodologyStatus = (typeof METHODOLOGY_STATUSES)[number];

export function isTacticalObjective(v: string): v is TacticalObjective {
  return (TACTICAL_OBJECTIVES as readonly string[]).includes(v);
}
export function isTechnicalObjective(v: string): v is TechnicalObjective {
  return (TECHNICAL_OBJECTIVES as readonly string[]).includes(v);
}
export function isMethodologyStatus(v: string): v is MethodologyStatus {
  return (METHODOLOGY_STATUSES as readonly string[]).includes(v);
}
