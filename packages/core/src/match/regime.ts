/**
 * F7.6c — Régimen de sustituciones por (categoría, división).
 *
 * Sustituye al flag temporal `categories.allow_reentry` (7.6) por un modelo real:
 * la regla de cambios sale de la pareja CATEGORÍA + DIVISIÓN del equipo. Los DATOS
 * de referencia (qué régimen aplica a cada categoría+división y qué divisiones
 * existen) viven en la tabla `substitution_regimes` (seed en migración) — fuente
 * única, no hardcode disperso. Aquí solo el TIPO y el COMPORTAMIENTO puro:
 *
 *  - **Corrido** (`rolling`): sustituciones ILIMITADAS y el que sale PUEDE
 *    reentrar (`allowReentry = true`).
 *  - **Limitado** (`limited`): máximo `maxSubs` sustituciones (7 en las divisiones
 *    de competición) y el que sale NO reentra (`allowReentry = false`).
 *
 * El nº de cambios se cuenta desde `match_events` (no de estado efímero). La
 * elegibilidad del que entra (reentrada) la resuelve `deriveSquad` con
 * `allowReentry`; el TOPE de cambios lo comprueba `canRegisterSubstitution`.
 */

export type RegimeType = 'rolling' | 'limited';

export interface SubstitutionRegime {
  type: RegimeType;
  /** Tope de sustituciones; null = ilimitado (corrido). */
  maxSubs: number | null;
  /** ¿El que sale puede VOLVER a entrar? */
  allowReentry: boolean;
}

/** Cambios corridos: ilimitados y con reentrada (fútbol base). */
export const ROLLING_REGIME: SubstitutionRegime = {
  type: 'rolling',
  maxSubs: null,
  allowReentry: true,
};

/** Régimen limitado: tope de cambios y sin reentrada (competición). */
export function limitedRegime(maxSubs: number): SubstitutionRegime {
  return { type: 'limited', maxSubs, allowReentry: false };
}

/**
 * Régimen por defecto cuando no hay fila para (categoría, división) — p.ej.
 * categorías adultas sin división de competición cargada. Por defecto CORRIDO
 * (coherente con el default histórico de base); editable migrando el seed.
 */
export const DEFAULT_REGIME: SubstitutionRegime = ROLLING_REGIME;

/**
 * ¿Se puede registrar OTRA sustitución dado el régimen y las ya hechas? En
 * corrido siempre; en limitado, mientras no se alcance el tope.
 */
export function canRegisterSubstitution(
  regime: SubstitutionRegime,
  subsSoFar: number,
): boolean {
  return regime.maxSubs == null || subsSoFar < regime.maxSubs;
}

/** Cambios restantes (null = ilimitado). Nunca negativo. */
export function subsRemaining(
  regime: SubstitutionRegime,
  subsSoFar: number,
): number | null {
  if (regime.maxSubs == null) return null;
  return Math.max(0, regime.maxSubs - subsSoFar);
}
