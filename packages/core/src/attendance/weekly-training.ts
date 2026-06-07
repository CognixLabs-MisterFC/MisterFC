/**
 * F7 (mejora) — Asistencia a entrenos de la SEMANA del partido (lunes–viernes).
 *
 * Para la convocatoria: junto a cada jugador, "(asistidos/total)" de los entrenos
 * de LUNES a VIERNES de la semana en la que cae el partido. PURO y testeable: el
 * caller resuelve las fechas civiles (zona Europe/Madrid) a 'YYYY-MM-DD' y este
 * módulo hace la aritmética de semana laboral + el conteo. Sin red ni DOM.
 *
 * "Asistido" = el jugador acudió: código en el bucket `present` o `partial`
 * (entreno diferenciado = acudió). Ausencias (justificadas o no) no cuentan como
 * asistidas. Si no hubo entrenos esa semana, `total` = 0 y el caller oculta el dato.
 */

import { bucketOf, type AttendanceCode } from '../schemas/attendance';

/** Entreno con su fecha civil (zona ya resuelta por el caller). */
export interface TrainingDay {
  id: string;
  /** 'YYYY-MM-DD' en la zona local del club. */
  date: string;
}

/** Una marca de asistencia (jugador × entreno). */
export interface AttendanceMark {
  playerId: string;
  eventId: string;
  code: AttendanceCode;
}

export interface WeeklyAttendance {
  attended: number;
  total: number;
}

/** ¿El código cuenta como "asistido" (acudió)? present o partial. */
export function isAttendedCode(code: AttendanceCode): boolean {
  const b = bucketOf(code);
  return b === 'present' || b === 'partial';
}

/**
 * Lunes y viernes (civiles, 'YYYY-MM-DD') de la semana que contiene `date`.
 * Cálculo en UTC sobre la fecha civil (sin hora ni zona) → determinista.
 */
export function workweekRange(date: string): { monday: string; friday: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=domingo … 6=sábado
  const daysSinceMonday = (dow + 6) % 7; // lunes=0 … domingo=6
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysSinceMonday);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { monday: iso(monday), friday: iso(friday) };
}

/**
 * IDs de los entrenos que caen en la franja LUNES–VIERNES de la semana del
 * partido. La comparación de cadenas 'YYYY-MM-DD' es válida (orden lexicográfico
 * = cronológico); sábado y domingo quedan fuera por estar fuera de [lunes,viernes].
 */
export function trainingsInMatchWeek(
  matchDate: string,
  trainings: readonly TrainingDay[],
): TrainingDay[] {
  const { monday, friday } = workweekRange(matchDate);
  return trainings.filter((tr) => tr.date >= monday && tr.date <= friday);
}

/**
 * Para cada `rosterId`, "(asistidos/total)" de los entrenos L–V de la semana del
 * partido. `total` = nº de entrenos de la franja; `attended` = aquellos en los que
 * el jugador acudió (present/partial). Sin entrenos → todos en 0/0 (el caller oculta).
 */
export function computeWeeklyTrainingAttendance(input: {
  matchDate: string;
  trainings: readonly TrainingDay[];
  attendance: readonly AttendanceMark[];
  rosterIds: readonly string[];
}): {
  totalTrainings: number;
  byPlayer: Map<string, WeeklyAttendance>;
} {
  const weekTrainings = trainingsInMatchWeek(input.matchDate, input.trainings);
  const weekIds = new Set(weekTrainings.map((t) => t.id));
  const total = weekTrainings.length;

  // Índice (playerId|eventId) -> código, solo para entrenos de la semana.
  const codeByKey = new Map<string, AttendanceCode>();
  for (const m of input.attendance) {
    if (weekIds.has(m.eventId)) codeByKey.set(`${m.playerId}|${m.eventId}`, m.code);
  }

  const byPlayer = new Map<string, WeeklyAttendance>();
  for (const playerId of input.rosterIds) {
    let attended = 0;
    for (const t of weekTrainings) {
      const code = codeByKey.get(`${playerId}|${t.id}`);
      if (code && isAttendedCode(code)) attended += 1;
    }
    byPlayer.set(playerId, { attended, total });
  }

  return { totalTrainings: total, byPlayer };
}
