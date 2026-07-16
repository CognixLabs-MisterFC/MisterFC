import type { LocalDay } from '@/lib/calendar-utils';
import type { HolidayInfo } from '../queries';

/**
 * F14F-2 — utilidades para casar festivos (fecha 'YYYY-MM-DD') con las celdas de
 * día del calendario. LocalDay.month es 0-based; la clave replica exactamente la
 * que usan los layouts al agrupar eventos (`${year}-${month}-${day}`).
 */

export function dayKey(d: LocalDay): string {
  return `${d.year}-${d.month}-${d.day}`;
}

/** 'YYYY-MM-DD' (día local) para pasar a la server action markHoliday. */
export function dayIso(d: LocalDay): string {
  return `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** Índice festivo → clave de día (mes 0-based, igual que dayKey). */
export function holidayByDayKey(holidays: HolidayInfo[]): Map<string, HolidayInfo> {
  const map = new Map<string, HolidayInfo>();
  for (const h of holidays) {
    const [y, m, d] = h.date.split('-').map((n) => parseInt(n, 10));
    if (y == null || m == null || d == null) continue;
    map.set(`${y}-${m - 1}-${d}`, h);
  }
  return map;
}
