/**
 * Helpers de fechas TZ-aware para la UI del calendario.
 *
 * Sin date-fns: usamos `Intl.DateTimeFormat` para todo lo locale-dependent
 * (formato es/en/va, mes/día semana) y aritmética simple sobre `Date.UTC`
 * para construir cuadrículas. Coherente con el patrón de packages/core
 * (events/tz.ts) y mantiene el bundle al mínimo (ver ADR-0006).
 */

import {
  fromZonedFields,
  TIMEZONE_OLA1,
  zonedFields,
  zonedIsoWeekday,
} from '@misterfc/core';

export type LocalDay = {
  /** Componentes locales (year, month 0-based, day). */
  year: number;
  month: number;
  day: number;
  /** Date UTC 00:00 local equivalente (útil como key estable). */
  utc: Date;
  /** ISO weekday 0=lun … 6=dom. */
  isoWeekday: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Construye un LocalDay para Y/M/D locales en la zona.
 */
function makeLocalDay(
  year: number,
  month: number,
  day: number,
  tz: string
): LocalDay {
  const utc = fromZonedFields(year, month, day, 0, 0, tz);
  return { year, month, day, utc, isoWeekday: zonedIsoWeekday(utc, tz) };
}

/**
 * Día actual en la zona Europe/Madrid (Ola 1).
 */
export function today(tz: string = TIMEZONE_OLA1, ref: Date = new Date()): LocalDay {
  const z = zonedFields(ref, tz);
  return makeLocalDay(z.year, z.month, z.day, tz);
}

/**
 * Suma N días a un día local (mismo TZ). DST-safe a nivel calendario porque
 * sumamos por fechas locales, no por milisegundos absolutos.
 */
export function addDays(day: LocalDay, n: number, tz: string = TIMEZONE_OLA1): LocalDay {
  // Aritmética sobre UTC del día: como UTC 00:00 local en cada lado del DST
  // sigue siendo el mismo "calendar day", desplazar +N·86400 funciona salvo
  // en el día exacto del cambio. Por seguridad usamos UTC fechas-puras.
  const pivot = new Date(Date.UTC(day.year, day.month, day.day));
  const moved = new Date(pivot.getTime() + n * MS_PER_DAY);
  return makeLocalDay(
    moved.getUTCFullYear(),
    moved.getUTCMonth(),
    moved.getUTCDate(),
    tz
  );
}

/**
 * Lunes de la semana del día (ISO).
 */
export function startOfWeek(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay {
  return addDays(day, -day.isoWeekday, tz);
}

export function endOfWeek(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay {
  return addDays(day, 6 - day.isoWeekday, tz);
}

export function startOfMonth(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay {
  return makeLocalDay(day.year, day.month, 1, tz);
}

export function endOfMonth(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay {
  // El día 0 del mes siguiente es el último día del mes actual.
  const next = new Date(Date.UTC(day.year, day.month + 1, 0));
  return makeLocalDay(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate(),
    tz
  );
}

/**
 * Devuelve la cuadrícula del mes: array de semanas (cada una con 7 LocalDay),
 * empezando desde el lunes que contiene el día 1 del mes y terminando en el
 * domingo que contiene el último día.
 */
export function monthGrid(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay[][] {
  const firstOfMonth = startOfMonth(day, tz);
  const lastOfMonth = endOfMonth(day, tz);
  const gridStart = startOfWeek(firstOfMonth, tz);
  const gridEnd = endOfWeek(lastOfMonth, tz);

  const weeks: LocalDay[][] = [];
  let cursor = gridStart;
  while (true) {
    const week: LocalDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1, tz);
    }
    weeks.push(week);
    if (
      cursor.year > gridEnd.year ||
      (cursor.year === gridEnd.year && cursor.month > gridEnd.month) ||
      (cursor.year === gridEnd.year &&
        cursor.month === gridEnd.month &&
        cursor.day > gridEnd.day)
    ) {
      break;
    }
  }
  return weeks;
}

/**
 * Los 7 días de la semana actual.
 */
export function weekGrid(day: LocalDay, tz: string = TIMEZONE_OLA1): LocalDay[] {
  const start = startOfWeek(day, tz);
  const out: LocalDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    out.push(addDays(start, i, tz));
  }
  return out;
}

/**
 * Rango de días [start, end] inclusivo.
 */
export function daysBetween(
  start: LocalDay,
  end: LocalDay,
  tz: string = TIMEZONE_OLA1
): LocalDay[] {
  const out: LocalDay[] = [];
  let cursor = start;
  while (
    cursor.year < end.year ||
    (cursor.year === end.year && cursor.month < end.month) ||
    (cursor.year === end.year &&
      cursor.month === end.month &&
      cursor.day <= end.day)
  ) {
    out.push(cursor);
    cursor = addDays(cursor, 1, tz);
  }
  return out;
}

export function isSameDay(a: LocalDay, b: LocalDay): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function isSameMonth(day: LocalDay, ref: LocalDay): boolean {
  return day.year === ref.year && day.month === ref.month;
}

/**
 * Compara dos `LocalDay`: <0 si a antes que b, 0 si igual, >0 si después.
 */
export function compareLocalDays(a: LocalDay, b: LocalDay): number {
  return (
    (a.year - b.year) * 10000 +
    (a.month - b.month) * 100 +
    (a.day - b.day)
  );
}

/**
 * Convierte un input ISO date (YYYY-MM-DD) a LocalDay.
 */
export function parseIsoDate(iso: string, tz: string = TIMEZONE_OLA1): LocalDay | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return makeLocalDay(
    parseInt(m[1]!, 10),
    parseInt(m[2]!, 10) - 1,
    parseInt(m[3]!, 10),
    tz
  );
}

export function toIsoDate(day: LocalDay): string {
  const m = String(day.month + 1).padStart(2, '0');
  const d = String(day.day).padStart(2, '0');
  return `${day.year}-${m}-${d}`;
}

/**
 * Convierte UN evento BD (`starts_at` timestamptz UTC) a su LocalDay en la
 * zona. Útil para agrupar eventos por día local.
 */
export function eventLocalDay(startsAtIso: string, tz: string = TIMEZONE_OLA1): LocalDay {
  const f = zonedFields(new Date(startsAtIso), tz);
  return makeLocalDay(f.year, f.month, f.day, tz);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────────────

const intlLocaleMap: Record<string, string> = {
  es: 'es-ES',
  en: 'en-GB',
  va: 'ca-ES', // valenciano comparte el ISO con catalán
};

function intlLocale(locale: string): string {
  return intlLocaleMap[locale] ?? locale;
}

export function formatMonthLong(
  day: LocalDay,
  locale: string,
  tz: string = TIMEZONE_OLA1
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    month: 'long',
    year: 'numeric',
  }).format(day.utc);
}

export function formatWeekRange(
  start: LocalDay,
  end: LocalDay,
  locale: string,
  tz: string = TIMEZONE_OLA1
): string {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
  });
  if (start.year === end.year) {
    return `${fmt.format(start.utc)} – ${fmt.format(end.utc)} ${start.year}`;
  }
  return `${fmt.format(start.utc)} ${start.year} – ${fmt.format(end.utc)} ${end.year}`;
}

export function formatDayNumber(day: LocalDay): string {
  return String(day.day);
}

export function formatWeekdayShort(
  day: LocalDay,
  locale: string,
  tz: string = TIMEZONE_OLA1
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    weekday: 'short',
  }).format(day.utc);
}

export function formatLongDate(
  day: LocalDay,
  locale: string,
  tz: string = TIMEZONE_OLA1
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(day.utc);
}

export function formatTime(
  iso: string,
  locale: string,
  tz: string = TIMEZONE_OLA1
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Componentes locales de un ISO UTC, formateados para inputs `datetime-local`
 * (YYYY-MM-DDTHH:MM).
 */
export function isoToLocalInput(iso: string, tz: string = TIMEZONE_OLA1): string {
  const f = zonedFields(new Date(iso), tz);
  const m = String(f.month + 1).padStart(2, '0');
  const d = String(f.day).padStart(2, '0');
  const h = String(f.hour).padStart(2, '0');
  const min = String(f.minute).padStart(2, '0');
  return `${f.year}-${m}-${d}T${h}:${min}`;
}

/**
 * Convierte el valor de un input `datetime-local` (YYYY-MM-DDTHH:MM) en la
 * zona indicada a un ISO UTC.
 */
export function localInputToIso(value: string, tz: string = TIMEZONE_OLA1): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new Error('local_input_invalid_format');
  const utc = fromZonedFields(
    parseInt(m[1]!, 10),
    parseInt(m[2]!, 10) - 1,
    parseInt(m[3]!, 10),
    parseInt(m[4]!, 10),
    parseInt(m[5]!, 10),
    tz
  );
  return utc.toISOString();
}

export const TIMEZONE = TIMEZONE_OLA1;
