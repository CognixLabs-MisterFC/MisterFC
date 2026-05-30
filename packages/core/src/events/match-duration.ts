/**
 * F4.9 — Helpers de duración de partido.
 *
 * Cuando el coach crea un evento type=match (o programa la convocatoria),
 * la app debe sugerirle horas razonables en vez de obligarle a calcular:
 *
 *   ends_at    ≈ starts_at + 2 × half_duration_minutes (de su categoría).
 *   citacion   ≈ starts_at − 60 minutos (default; editable).
 *
 * Los helpers son puros: no leen Date.now() ni el reloj, solo aritmética
 * sobre el ISO entrante. Eso los hace testables con vitest sin mocks de
 * tiempo.
 */

const MS_PER_MIN = 60_000;

/** Por defecto la convocatoria es 60 min antes del kickoff. */
export const DEFAULT_CITACION_LEAD_MINUTES = 60;

/**
 * Devuelve el ISO de fin estimado de un partido dado el kickoff y la
 * duración por tiempo de la categoría. Total = 2 × half (sin contar
 * descanso, despreciable a efectos de planificación).
 *
 * - Si halfDurationMinutes ≤ 0 → null (no sabemos, deja que UI lo deje vacío).
 * - Si startsAtIso es inválido → null.
 */
export function computeEndsAt(
  startsAtIso: string | null | undefined,
  halfDurationMinutes: number | null | undefined,
): string | null {
  if (!startsAtIso || !halfDurationMinutes || halfDurationMinutes <= 0) {
    return null;
  }
  const t = Date.parse(startsAtIso);
  if (!Number.isFinite(t)) return null;
  const totalMs = 2 * halfDurationMinutes * MS_PER_MIN;
  return new Date(t + totalMs).toISOString();
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
