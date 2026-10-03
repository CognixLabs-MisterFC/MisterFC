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
 * Régimen por defecto cuando NO hay fila para (categoría, división): categoría sin
 * divisiones cargadas en `substitution_regimes`, equipo con `division` nula, o par
 * que no existe en el catálogo.
 *
 * **LIMITADO A 7 SIN REENTRADA, y el porqué es lo importante.** Esto estuvo en
 * `ROLLING_REGIME` y era el fallo del lado equivocado: un hueco en los datos de
 * referencia regalaba cambios ILIMITADOS con reentrada, en silencio. Ni un error, ni
 * un aviso en pantalla, ni forma de notarlo salvo mirando la tabla. Le pasó a `senior`,
 * que no tenía ni una fila: un senior de tercera jugaba con la regla contraria a la
 * real y nada lo decía.
 *
 * La regla confirmada por Jose es que el corrido es la EXCEPCIÓN —cadete e infantil de
 * primera y segunda, y alevín, benjamín, prebenjamín y querubín— y que todo lo demás
 * son 7 sin reentrada. Así que el valor por defecto correcto es también el seguro: si
 * falta el dato, se aplica la regla más restrictiva. Equivocarse limitando se nota en
 * el acto —el entrenador ve "0 cambios restantes" y lo dice— mientras que equivocarse
 * permitiendo no se nota hasta que el árbitro no deja hacer el octavo.
 *
 * Esto NO sustituye a tener la fila: un equipo cuya división sí da corrido y que caiga
 * aquí recibirá 7 cambios, que es incorrecto para él. El arreglo de ese caso es poner
 * su `division`, y este valor solo decide hacia dónde se falla mientras no esté.
 */
export const DEFAULT_REGIME: SubstitutionRegime = limitedRegime(7);

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
