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

// ── Recomendación de ejercicios para el picker (12.2b) ───────────────────────
/** Forma mínima de un ejercicio para decidir si encaja con la sesión. */
export type RecommendableExercise = {
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
};

/** Criterio de la sesión: categoría del equipo (CATEGORY_KIND, o null si la
 *  categoría no tiene `kind` — p.ej. categoría custom) + objetivos de la cabecera. */
export type RecommendCriteria = {
  category: string | null;
  tactical: string[];
  technical: string[];
};

/** ¿Hay criterio suficiente para recomendar? (sin objetivos no se recomienda). */
export function canRecommend(c: RecommendCriteria): boolean {
  return c.tactical.length + c.technical.length > 0;
}

/**
 * ¿Es el ejercicio RECOMENDADO para la sesión? Cumple AMBAS:
 *  - comparte ≥1 objetivo (táctico o técnico) con los objetivos de la sesión, Y
 *  - su categoría incluye la categoría del equipo de la sesión.
 * Si la categoría del equipo es desconocida (`category` null — p.ej. categoría sin
 * `kind`), NO se exige la categoría (se recomienda solo por objetivos) para no
 * vaciar la lista por un dato faltante. Sin objetivos de sesión → no recomienda.
 */
export function isRecommendedExercise(
  ex: RecommendableExercise,
  c: RecommendCriteria
): boolean {
  const sessionObjectives = [...c.tactical, ...c.technical];
  if (sessionObjectives.length === 0) return false;

  const exObjectives = [...ex.tactical_objectives, ...ex.technical_objectives];
  const sharesObjective = exObjectives.some((o) => sessionObjectives.includes(o));
  if (!sharesObjective) return false;

  if (c.category != null && !ex.categories.includes(c.category)) return false;
  return true;
}

// ── Type guards ───────────────────────────────────────────────────────────────
export function isSessionBlockType(v: string): v is SessionBlockType {
  return (SESSION_BLOCK_TYPES as readonly string[]).includes(v);
}
export function isSessionVisibility(v: string): v is SessionVisibility {
  return (SESSION_VISIBILITIES as readonly string[]).includes(v);
}
