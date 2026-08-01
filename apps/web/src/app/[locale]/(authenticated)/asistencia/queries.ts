/**
 * F4 Lote A — Queries de asistencia a entrenamientos.
 *
 * Reusa `events` (F3) + `team_members` (F2.5) + `training_attendance` (F4.1).
 * Sin modelo nuevo más allá del propio Lote A.
 *
 * Permisos de lectura:
 *  - admin / coord / principal / ayudante → ven asistencia de su team_id
 *    (hereda RLS de events_select_member, bug F3-rls-events-visibilidad
 *    sigue activo en BD: la UI filtra por scope).
 *  - jugador → ver solo su propia fila (filtramos por player_id vinculado).
 *
 * Permisos de escritura: ver `actions.ts`.
 */

import {
  type AttendanceCode,
  type AttendanceScope,
  type StaffTrainingEvent,
  type AttendanceRecord as CoreAttendanceRow,
  type AttendanceRosterPlayer,
  type EventAttendanceData as CoreEventAttendanceData,
  createSupabaseServerClient,
  getAttendanceStatsFromClient,
  getCurrentUser,
  getEventAttendanceFromClient,
  getRecentTrainingsFromClient,
  resolveAttendanceScopeFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { Role } from '../jugadores/queries';

// O2-7a — Tipos y lectura extraídos a core (staff-queries/scope). La web mantiene
// los MISMOS nombres (re-export) y firmas; solo delega el cuerpo. Comportamiento
// idéntico: mismas queries, mismo mapeo, misma ordenación.
export type TrainingEvent = StaffTrainingEvent;
export type AttendanceRow = CoreAttendanceRow;
export type RosterPlayer = AttendanceRosterPlayer;
export type EventAttendanceData = CoreEventAttendanceData;
export type AsistenciaScope = AttendanceScope;

/**
 * Scope de visibilidad del user para asistencia. Delega en core
 * `resolveAttendanceScopeFromClient` (mismo criterio); aquí solo se resuelve el
 * cliente/cookie y el `userId`.
 */
export async function resolveAsistenciaScope(
  clubId: string,
  role: Role
): Promise<AsistenciaScope> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  return resolveAttendanceScopeFromClient(supabase, {
    clubId,
    role,
    userId: user?.id ?? null,
  });
}

/**
 * Entrenamientos recientes (últimos `rangeDays` días) con conteo marcados/roster.
 * Delega en core `getRecentTrainingsFromClient`.
 */
export async function loadRecentTrainings(
  clubId: string,
  role: Role,
  rangeDays: number = 30,
  teamId?: string
): Promise<TrainingEvent[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  return getRecentTrainingsFromClient(supabase, {
    clubId,
    role,
    userId: user?.id ?? null,
    rangeDays,
    teamId,
  });
}

/**
 * Detalle de un evento para la pantalla de marcado (meta + roster histórico +
 * asistencia registrada + canRecord). Delega en core `getEventAttendanceFromClient`.
 */
export async function loadEventAttendance(
  clubId: string,
  role: Role,
  eventId: string
): Promise<EventAttendanceData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  return getEventAttendanceFromClient(supabase, {
    clubId,
    role,
    userId: user?.id ?? null,
    eventId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats (F4.8)
// ─────────────────────────────────────────────────────────────────────────────

export type StatsRange = '7d' | '30d' | 'season' | 'custom';

export type StatsFilters = {
  range: StatsRange;
  customStart?: string;
  customEnd?: string;
  teamId?: string;
};

export type PlayerStat = {
  player_id: string;
  first_name: string;
  last_name: string;
  team_id: string;
  team_name: string;
  total: number;
  present: number;
  justified: number;
  unjustified: number;
  partial: number;
  pct_present: number;
};

export type CodeBucket = {
  code: AttendanceCode;
  count: number;
  pct: number;
};

export type AsistenciaStats = {
  byPlayer: PlayerStat[];
  byCode: CodeBucket[];
  totalRecorded: number;
};

function rangeToWindow(
  filters: StatsFilters
): { startIso: string; endIso: string } {
  const now = new Date();
  if (filters.range === 'custom' && filters.customStart && filters.customEnd) {
    return {
      startIso: new Date(`${filters.customStart}T00:00:00Z`).toISOString(),
      endIso: new Date(`${filters.customEnd}T23:59:59Z`).toISOString(),
    };
  }
  if (filters.range === '7d') {
    return {
      startIso: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  if (filters.range === '30d') {
    return {
      startIso: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  // 'season' — usa el 1 de agosto del año actual o anterior.
  const year =
    now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    startIso: new Date(Date.UTC(year, 7, 1)).toISOString(),
    endIso: now.toISOString(),
  };
}

export async function loadAsistenciaStats(
  clubId: string,
  role: Role,
  filters: StatsFilters
): Promise<AsistenciaStats> {
  const scope = await resolveAsistenciaScope(clubId, role);
  if (scope.kind === 'none') {
    return { byPlayer: [], byCode: [], totalRecorded: 0 };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { startIso, endIso } = rangeToWindow(filters);

  // O2-5 E1 — el fetch+agregación se extrajo a core (getAttendanceStatsFromClient)
  // para compartirlo con la app nativa de familia. Mismas queries, mismo mapeo de
  // códigos y ordenación: comportamiento idéntico. Aquí solo se resuelve el scope
  // (server-only) y la ventana temporal.
  return getAttendanceStatsFromClient(supabase, {
    clubId,
    scope,
    startIso,
    endIso,
    teamId: filters.teamId,
  });
}
