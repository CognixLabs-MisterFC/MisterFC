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

// ── Type guards ───────────────────────────────────────────────────────────────
export function isSessionBlockType(v: string): v is SessionBlockType {
  return (SESSION_BLOCK_TYPES as readonly string[]).includes(v);
}
export function isSessionVisibility(v: string): v is SessionVisibility {
  return (SESSION_VISIBILITIES as readonly string[]).includes(v);
}
