/**
 * Generador puro de ocurrencias para series semanales (ADR-0005).
 *
 * Reglas:
 *   - `freq: 'weekly'` único valor soportado.
 *   - `count` = número de SEMANAS de la serie, no de hijos generados.
 *     Total hijos ≈ count × by_weekday.length, restando los días previos al
 *     parent dentro de la semana 0 (parcial).
 *   - El parent es siempre la primera ocurrencia. Su día-de-semana local debe
 *     estar en `by_weekday` (la validación al input lo enforce; aquí
 *     defensivamente se ignoraría si no lo está).
 *   - `until` es una fecha local YYYY-MM-DD inclusiva: se acepta cualquier
 *     ocurrencia cuyo `starts_at` caiga en o antes del 23:59:59.999 local
 *     del día `until`.
 *   - Sin acceso a clock ni Math.random: 100% determinista para tests.
 */

import {
  fromZonedFields,
  zonedFields,
  zonedIsoWeekday,
} from './tz';
import type { RecurrenceRule } from './types';

export type Occurrence = { starts_at: Date; ends_at: Date | null };

export const MAX_RECURRENCE_WEEKS = 52;

const MS_PER_DAY = 86_400_000;

export function expandRecurrence(
  parentStartsAt: Date,
  parentEndsAt: Date | null,
  rule: RecurrenceRule,
  timeZone: string
): Occurrence[] {
  if (rule.freq !== 'weekly') {
    throw new Error('only_weekly_supported');
  }
  if (rule.by_weekday.length === 0) {
    throw new Error('by_weekday_empty');
  }
  if (rule.interval < 1 || rule.interval > 4) {
    throw new Error('invalid_interval');
  }
  const hasCount = rule.count != null;
  const hasUntil = rule.until != null;
  if (hasCount === hasUntil) {
    throw new Error('count_xor_until');
  }
  if (hasCount && (rule.count! < 1 || rule.count! > MAX_RECURRENCE_WEEKS)) {
    throw new Error('count_out_of_range');
  }

  const local = zonedFields(parentStartsAt, timeZone);
  const durationMs =
    parentEndsAt != null
      ? parentEndsAt.getTime() - parentStartsAt.getTime()
      : null;

  const sortedDays = [...new Set(rule.by_weekday)].sort((a, b) => a - b);

  const parentIso = zonedIsoWeekday(parentStartsAt, timeZone);
  // La fecha local del lunes de la semana del parent.
  const mondayY = local.year;
  const mondayM = local.month;
  const mondayD = local.day - parentIso;

  const occurrences: Occurrence[] = [];

  const untilCutoff =
    rule.until != null ? parseUntilCutoff(rule.until, timeZone) : null;

  const weeksToIterate = rule.count ?? MAX_RECURRENCE_WEEKS;

  for (let w = 0; w < weeksToIterate; w += 1) {
    const weekOffsetDays = w * rule.interval * 7;
    for (const iso of sortedDays) {
      if (w === 0 && iso < parentIso) continue;
      const days = weekOffsetDays + iso;
      // Construye la fecha local del día: usamos Date.UTC para sumar días sin
      // problemas de DST en la fecha (solo aritmética de calendario).
      const pivot = new Date(
        Date.UTC(mondayY, mondayM, mondayD + days)
      );
      const y = pivot.getUTCFullYear();
      const m = pivot.getUTCMonth();
      const d = pivot.getUTCDate();
      const starts_at = fromZonedFields(
        y,
        m,
        d,
        local.hour,
        local.minute,
        timeZone
      );

      if (untilCutoff != null && starts_at.getTime() > untilCutoff) {
        return occurrences;
      }

      const ends_at =
        durationMs != null ? new Date(starts_at.getTime() + durationMs) : null;

      occurrences.push({ starts_at, ends_at });
    }
  }

  return occurrences;
}

function parseUntilCutoff(until: string, timeZone: string): number {
  const [ys, ms, ds] = until.split('-');
  if (!ys || !ms || !ds) throw new Error('until_invalid_format');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10) - 1;
  const d = parseInt(ds, 10);
  // 23:59:59 local. Por simplicidad usamos 23:59:00.
  return fromZonedFields(y, m, d, 23, 59, timeZone).getTime();
}

/**
 * Cuenta cuántas ocurrencias generaría una regla sin materializarlas. Útil
 * para mostrar al usuario en el form "108 ocurrencias generadas" antes de
 * pulsar guardar.
 */
export function countOccurrences(
  parentStartsAt: Date,
  rule: RecurrenceRule,
  timeZone: string
): number {
  return expandRecurrence(parentStartsAt, null, rule, timeZone).length;
}

/**
 * Distancia en días entre dos fechas locales en la misma zona. Útil para
 * "máximo 365 días" en la validación de `until`.
 */
export function localDaysBetween(
  a: Date,
  b: Date,
  timeZone: string
): number {
  const za = zonedFields(a, timeZone);
  const zb = zonedFields(b, timeZone);
  const aMs = Date.UTC(za.year, za.month, za.day);
  const bMs = Date.UTC(zb.year, zb.month, zb.day);
  return Math.round((bMs - aMs) / MS_PER_DAY);
}
