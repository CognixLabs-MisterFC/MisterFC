/**
 * F9.2 — Stats DERIVADAS (ratios) + desglose de ASISTENCIA (PURO, sin red ni DOM).
 *
 * Spec 9.0 §6: sobre los agregados de 9.1 (`AggregatedStats`) se calculan ratios
 * por partido; y sobre las filas de `training_attendance` de la temporada se hace
 * el desglose por código y por **bucket de ADR-0007** (present/justified/
 * unjustified/partial) reutilizando `bucketOf` — NO se reinventa el mapeo.
 *
 * Convención de división por cero: ratio sobre 0 partidos = `null` (la UI pinta
 * "—"); `presentPct` sobre 0 entrenos = `null`.
 */

import type { AggregatedStats } from './aggregate';
import {
  ATTENDANCE_CODES,
  bucketOf,
  type AttendanceCode,
  type AttendanceBucket,
} from '../schemas/attendance';

/** Ratios por partido (y por 90′) derivados de los totales de la temporada. */
export interface DerivedRatios {
  /** goles / partido. `null` si no hay partidos. */
  goalsPerMatch: number | null;
  /** goles · 90 / minutos. `null` si no hay minutos. */
  goalsPer90: number | null;
  assistsPerMatch: number | null;
  minutesPerMatch: number | null;
  /** titularidades / partidos, en 0..1. `null` si no hay partidos. */
  startRate: number | null;
  /** (amarillas + rojas) / partido. `null` si no hay partidos. */
  cardsPerMatch: number | null;
  foulsCommittedPerMatch: number | null;
  foulsReceivedPerMatch: number | null;
}

function perMatch(value: number, matches: number): number | null {
  return matches > 0 ? value / matches : null;
}

export function derivedRatios(stats: AggregatedStats): DerivedRatios {
  const { matches, minutesPlayed } = stats;
  return {
    goalsPerMatch: perMatch(stats.goals, matches),
    goalsPer90: minutesPlayed > 0 ? (stats.goals * 90) / minutesPlayed : null,
    assistsPerMatch: perMatch(stats.assists, matches),
    minutesPerMatch: perMatch(minutesPlayed, matches),
    startRate: matches > 0 ? stats.starts / matches : null,
    cardsPerMatch: perMatch(stats.yellowCards + stats.redCards, matches),
    foulsCommittedPerMatch: perMatch(stats.foulsCommitted, matches),
    foulsReceivedPerMatch: perMatch(stats.foulsReceived, matches),
  };
}

/** Una fila mínima de `training_attendance` para el desglose. */
export interface AttendanceRow {
  code: AttendanceCode;
}

export interface AttendanceBreakdown {
  total: number;
  /** Conteo por cada código de asistencia (todos los códigos, 0 incluidos). */
  perCode: Record<AttendanceCode, number>;
  /** Conteo por bucket de ADR-0007. */
  perBucket: Record<AttendanceBucket, number>;
  /** present / total, en 0..1. `null` si no hubo entrenos. */
  presentPct: number | null;
}

function zeroByCode(): Record<AttendanceCode, number> {
  // Inicializa TODOS los códigos a 0 (la UI lista el desglose completo).
  return Object.fromEntries(ATTENDANCE_CODES.map((c) => [c, 0])) as Record<
    AttendanceCode,
    number
  >;
}

/**
 * Desglose de la asistencia a entrenos del jugador en la temporada: conteo por
 * código, conteo por bucket (ADR-0007 vía `bucketOf`) y % de presencia.
 */
export function attendanceBreakdown(
  rows: readonly AttendanceRow[]
): AttendanceBreakdown {
  const perCode = zeroByCode();
  const perBucket: Record<AttendanceBucket, number> = {
    present: 0,
    justified: 0,
    unjustified: 0,
    partial: 0,
  };
  for (const r of rows) {
    perCode[r.code] += 1;
    perBucket[bucketOf(r.code)] += 1;
  }
  const total = rows.length;
  return {
    total,
    perCode,
    perBucket,
    presentPct: total > 0 ? perBucket.present / total : null,
  };
}
