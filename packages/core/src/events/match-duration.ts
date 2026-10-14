/**
 * F4.9 — Helpers de duración de partido.
 *
 * Cuando el coach crea un evento type=match (o programa la convocatoria), la app
 * le sugiere horas razonables en vez de obligarle a calcular:
 *
 *   ends_at  ≈ starts_at + el BLOQUE que ocupa el partido (ver abajo).
 *   citacion ≈ starts_at − 60 minutos (default; editable).
 *
 * Los helpers son puros: no leen Date.now() ni el reloj, solo aritmética sobre el
 * ISO entrante. Eso los hace testables con vitest sin mocks de tiempo.
 *
 * ── EL BLOQUE, Y POR QUÉ YA NO ES «2 × MITAD + 15» ──────────────────────────
 * Hasta la migración 20261124000000 esto sumaba `2 × half_duration_minutes + 15`,
 * con el 2 y el 15 escritos a mano, y el 15 era una constante exportada
 * (`HALFTIME_BREAK_MINUTES`) cuya cabecera afirmaba que «NO depende de la
 * categoría». Las dos cosas eran falsas para querubines, que juegan TRES tiempos
 * de doce con descansos de CUATRO: la sugerencia daba 39 minutos para un partido
 * que ocupa 44, o sea que el bloque no cabía en sí mismo.
 *
 * Ahora los tres números salen de la categoría —`period_count`,
 * `half_duration_minutes` y `break_minutes`— y la cuenta es:
 *
 *   bloque = periodos × duración + (periodos − 1) × descanso
 *
 * Con dos periodos eso es exactamente lo de siempre (45+15+45 = 105); con tres,
 * 12+4+12+4+12 = 44. El «(periodos − 1)» es lo que hace que la fórmula no tenga
 * que saber cuántos tiempos hay: hay un descanso menos que tiempos, siempre.
 *
 * ── POR QUÉ `matchBlockMinutes` ES PÚBLICA ──────────────────────────────────
 * Porque el diálogo del calendario necesita el MISMO número para dos cosas: el
 * `ends_at` que rellena y el cartel que le explica al coach de dónde sale. Antes
 * el cartel repetía la fórmula a mano (`2 * half + HALFTIME_BREAK_MINUTES`), así
 * que había dos cuentas que podían separarse y una de ellas no tenía test. Con la
 * cuenta exportada hay una sola, y arreglar una arregla las dos.
 */

const MS_PER_MIN = 60_000;

/** Por defecto la convocatoria es 60 min antes del kickoff. */
export const DEFAULT_CITACION_LEAD_MINUTES = 60;

/**
 * La forma del partido, tal como la trae la categoría. Los tres campos son
 * OBLIGATORIOS a propósito: cuando eran dos y el resto constantes, el sitio que
 * se olvidó de la tercera (el cartel) no dio error de tipos ni de test, solo una
 * cifra mal. Que falte uno tiene que ser un error de compilación, no un minuto
 * equivocado en pantalla.
 */
export type MatchBlockShape = {
  /** Duración nominal de CADA periodo regular (minutos). */
  halfDurationMinutes: number | null | undefined;
  /** Cuántos periodos regulares juega la categoría: 2 (dos partes) o 3. */
  periodCount: number | null | undefined;
  /** Descanso ENTRE periodos (minutos). Puede ser 0: hay torneos del tirón. */
  breakMinutes: number | null | undefined;
};

/**
 * Minutos que ocupa el partido entero, descansos incluidos:
 *
 *   periodos × duración + (periodos − 1) × descanso
 *
 * Devuelve `null` cuando no se puede saber —duración ausente o ≤ 0, periodos
 * ausentes o < 1, descanso ausente o negativo—, y entonces la UI no sugiere nada
 * en vez de sugerir un número inventado. Ojo con el descanso: `0` es un valor
 * LEGÍTIMO, así que se comprueba con `== null`, no con `!pausa`.
 */
export function matchBlockMinutes(shape: MatchBlockShape): number | null {
  const duracion = shape.halfDurationMinutes;
  if (duracion == null || duracion <= 0) return null;

  const periodos = shape.periodCount;
  if (periodos == null || periodos < 1) return null;

  const pausa = shape.breakMinutes;
  if (pausa == null || pausa < 0) return null;

  return periodos * duracion + (periodos - 1) * pausa;
}

/**
 * Devuelve el ISO de fin estimado de un partido dado el kickoff y la forma del
 * partido. `null` si el kickoff es inválido o si el bloque no se puede calcular.
 */
export function computeEndsAt(
  startsAtIso: string | null | undefined,
  shape: MatchBlockShape,
): string | null {
  if (!startsAtIso) return null;

  const minutos = matchBlockMinutes(shape);
  if (minutos == null) return null;

  const t = Date.parse(startsAtIso);
  if (!Number.isFinite(t)) return null;

  return new Date(t + minutos * MS_PER_MIN).toISOString();
}

/**
 * Devuelve el ISO de la hora de convocatoria (citacion) sugerida — por
 * defecto 60 min antes del kickoff. Permite override del lead para casos
 * especiales (p.ej. partidos en otra provincia → 120 min).
 *
 * - Si startsAtIso es inválido → null.
 * - Si leadMinutes < 0 → tratamos como 0 (no retrocede al futuro).
 */
export function computeCitacionAt(
  startsAtIso: string | null | undefined,
  leadMinutes: number = DEFAULT_CITACION_LEAD_MINUTES,
): string | null {
  if (!startsAtIso) return null;
  const t = Date.parse(startsAtIso);
  if (!Number.isFinite(t)) return null;
  const lead = Math.max(0, leadMinutes);
  return new Date(t - lead * MS_PER_MIN).toISOString();
}
