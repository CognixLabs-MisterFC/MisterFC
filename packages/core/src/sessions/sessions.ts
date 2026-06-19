/**
 * F12 — Vocabularios y esqueleto del planificador de sesiones (constantes puras).
 *
 * Spec: docs/specs/12.0-planificador-sesiones.md §3 (D1) / §4. Fuente de verdad
 * de los VALORES (en español) que también lista el CHECK de la migración 12.1
 * (`sessions`/`session_blocks`) y que consumen los Zod del editor (12.2).
 * Mantener en sync con la migración `sessions`.
 *
 * Los objetivos de la cabecera REÚSAN los vocabularios de ejercicios
 * (`TACTICAL_OBJECTIVES`/`TECHNICAL_OBJECTIVES` de F11): no se duplican aquí.
 *
 * Convención: claves en inglés, VALORES de dominio en español (sin traducir; la
 * etiqueta visible se localiza vía i18n). Puro: sin DOM, sin BD, sin React.
 */

import { zonedFields } from '../events/tz';
import { TIMEZONE_OLA1 } from '../events/types';

// ── Tipos de bloque (catálogo FIJO en v1 — D1) ───────────────────────────────
// Estilo CATEGORY_KINDS: el conjunto cerrado de bloques de una sesión. Añadir/
// quitar tipos o catálogo configurable por club = backlog (futuro F17).
export const SESSION_BLOCK_TYPES = [
  'calentamiento',
  'complementaria',
  'principal',
  'vuelta_a_la_calma',
] as const;
export type SessionBlockType = (typeof SESSION_BLOCK_TYPES)[number];

// ── Esqueleto estándar sembrado al crear una sesión (D1) ─────────────────────
// 5 bloques EN ORDEN: calentamiento, complementaria, principal, principal,
// vuelta_a_la_calma. La SIEMBRA efectiva (insert de filas) la hace la capa de
// app en 12.2 con `buildDefaultSkeleton()`; aquí solo se define la pieza para
// que el clonado de plantillas (12.6) pueda OPTAR por no sembrar.
export const DEFAULT_SESSION_SKELETON = [
  'calentamiento',
  'complementaria',
  'principal',
  'principal',
  'vuelta_a_la_calma',
] as const satisfies readonly SessionBlockType[];

// ── Visibilidad (D3) ─────────────────────────────────────────────────────────
// staff (default) | team (jugadores Y familias del team_id la ven read-only).
export const SESSION_VISIBILITIES = ['staff', 'team'] as const;
export type SessionVisibility = (typeof SESSION_VISIBILITIES)[number];

// ── Bloque sembrado (forma de cada fila del esqueleto) ───────────────────────
export type SeededBlock = {
  block_type: SessionBlockType;
  order_idx: number;
};

/**
 * Construye el esqueleto estándar a sembrar al crear una sesión: una fila por
 * bloque de `DEFAULT_SESSION_SKELETON`, con `order_idx` 0..n correlativo. Puro y
 * testeable; la capa de app (12.2) lo persiste en `session_blocks`.
 */
export function buildDefaultSkeleton(): SeededBlock[] {
  return DEFAULT_SESSION_SKELETON.map((block_type, order_idx) => ({
    block_type,
    order_idx,
  }));
}

// ── Recomendación de ejercicios para el picker (12.2b + fase-aware 12.7a) ─────
/** Forma mínima de un ejercicio para decidir si encaja con un bloque de la sesión. */
export type RecommendableExercise = {
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  /** Fases (tipos de bloque) para las que sirve el ejercicio (12.7a). Vacío =
   *  cualquier fase. */
  phases: string[];
};

/** Criterio del BLOQUE concreto que se está rellenando: su fase (tipo de bloque) +
 *  la categoría del equipo (CATEGORY_KIND, o null si la categoría no tiene `kind`) +
 *  los objetivos de la cabecera de la sesión. */
export type RecommendCriteria = {
  phase: SessionBlockType | null;
  category: string | null;
  tactical: string[];
  technical: string[];
};

/**
 * ¿Hay criterio suficiente para que la recomendación FILTRE algo? Con la regla
 * fase-aware (12.7a) basta con conocer la fase del bloque (siempre la hay en el
 * picker) o tener categoría/objetivos. Sin nada de eso, no se filtra (se ven todos).
 */
export function canRecommend(c: RecommendCriteria): boolean {
  return c.phase != null || c.category != null || c.tactical.length + c.technical.length > 0;
}

/**
 * ¿Es el ejercicio RECOMENDADO para un bloque de tipo `c.phase`? (regla 12.7a)
 * Cumple las TRES cláusulas (cada una pasa también si el ejercicio no tiene ese dato):
 *  1. fase: el ejercicio tiene la fase del bloque  O  no tiene ninguna fase.
 *  2. categoría: la categoría del equipo encaja  O  el ejercicio no tiene categoría
 *     (o la categoría del equipo es desconocida → no se exige).
 *  3. objetivos: comparte ≥1 objetivo táctico/técnico con la sesión  O  el ejercicio
 *     no tiene objetivos.
 * Así un ejercicio de calentamiento SIN objetivos sale en el bloque de calentamiento,
 * y uno con objetivo de la parte principal sale en el principal.
 */
export function isRecommendedExercise(
  ex: RecommendableExercise,
  c: RecommendCriteria
): boolean {
  // 1. Fase del bloque.
  const phaseOk = c.phase == null || ex.phases.length === 0 || ex.phases.includes(c.phase);
  if (!phaseOk) return false;

  // 2. Categoría del equipo.
  const categoryOk =
    c.category == null || ex.categories.length === 0 || ex.categories.includes(c.category);
  if (!categoryOk) return false;

  // 3. Objetivos de la sesión.
  const exObjectives = [...ex.tactical_objectives, ...ex.technical_objectives];
  const sessionObjectives = [...c.tactical, ...c.technical];
  const objectivesOk =
    exObjectives.length === 0 ||
    sessionObjectives.length === 0 ||
    exObjectives.some((o) => sessionObjectives.includes(o));
  if (!objectivesOk) return false;

  return true;
}

// ── Semana / microciclo (12.3) ───────────────────────────────────────────────
// Fechas como string YYYY-MM-DD; cálculo en UTC para evitar desfases de zona.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha YYYY-MM-DD válida? */
export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Suma `n` días a una fecha YYYY-MM-DD (n puede ser negativo). */
export function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes (inicio de semana) de la semana que contiene `dateIso`. */
export function mondayOfWeek(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=domingo … 6=sábado
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDaysIso(dateIso, diff);
}

/** Los 7 días (lunes→domingo) de la semana que empieza en `mondayIso`. */
export function weekDaysIso(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mondayIso, i));
}

// ── Link sesión ↔ entrenamiento (12.8a) ──────────────────────────────────────
/**
 * Deriva la fecha de la sesión (YYYY-MM-DD) desde el `starts_at` (ISO/timestamptz)
 * de un evento de entrenamiento, en la zona horaria del club. Así un entrenamiento
 * a las 23:30 (hora local) cae en su día local correcto, no en el del UTC. Reúsa
 * `zonedFields` (events/tz). Por defecto Europe/Madrid (TIMEZONE_OLA1, Ola 1).
 */
export function sessionDateFromEventStart(
  startsAtIso: string,
  timeZone: string = TIMEZONE_OLA1
): string {
  const { year, month, day } = zonedFields(new Date(startsAtIso), timeZone);
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

// ── Type guards ───────────────────────────────────────────────────────────────
export function isSessionBlockType(v: string): v is SessionBlockType {
  return (SESSION_BLOCK_TYPES as readonly string[]).includes(v);
}
export function isSessionVisibility(v: string): v is SessionVisibility {
  return (SESSION_VISIBILITIES as readonly string[]).includes(v);
}
