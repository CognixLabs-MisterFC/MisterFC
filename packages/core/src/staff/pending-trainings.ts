/**
 * O2-16 — Entrenamientos PENDIENTES del cuerpo técnico (coach-scoped). Alimentan el
 * inicio del entrenador (contador de la tarjeta) y su lista dedicada: UN SOLO loader
 * por tarea sirve las dos cosas → el número de la tarjeta y las filas de la lista
 * SIEMPRE cuadran (misma query).
 *
 * DOS tareas, dos ventanas distintas (decisión de Jose):
 *  · Sin pasar lista → entrenos PASADOS SIN LÍMITE de tiempo, solo los que no tienen
 *    ninguna fila de asistencia. Lista propia nueva (NO la de `/staff/asistencia`,
 *    que es el histórico completo con marcados y sin marcar y la comparte la web).
 *  · Sin sesión → entrenos a menos de 24 h sin sesión real vinculada.
 *
 * SCOPE = SUS equipos: se filtra por `team_id IN (teamIds)`, NUNCA por `club_id` solo
 * (por RLS le llegarían partidos/eventos club-wide y contaría tareas ajenas). Los
 * `teamIds` los resuelve el caller con `getStaffTeamsFromClient`, que YA acota a la
 * TEMPORADA ACTIVA (el team_id cambia en el rollover) → el alcance de temporada se
 * cumple sin filtro extra por season aquí.
 *
 * NO comparte código con los conteos de dirección (`direction/home-counts.ts`): esos
 * son club-wide y con umbrales propios (48 h / 72 h / 60 d) que NO se tocan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

/** Una fila de entreno pendiente (lista + conteo derivado de `.length`). */
export type StaffPendingTraining = {
  id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  category_name: string;
  starts_at: string;
};

/** Límite muy por encima del volumen de UNA temporada (un equipo entrena ~120-160
 *  veces/temporada; un coordinador con varios equipos no llega a este techo), de modo
 *  que la ventana "sin límite de tiempo" no se recorta en la práctica. */
const SEASON_SAFE_LIMIT = 1000;

/** 24 h en milisegundos (ventana de "sin sesión"). */
const WITHOUT_SESSION_WINDOW_MS = 24 * 3_600_000;

type EventRow = {
  id: string;
  team_id: string;
  starts_at: string;
  teams: {
    name: string;
    color: string;
    categories: { name: string };
  };
};

function toPending(rows: EventRow[]): StaffPendingTraining[] {
  return rows.map((e) => ({
    id: e.id,
    team_id: e.team_id,
    team_name: e.teams.name,
    team_color: e.teams.color,
    category_name: e.teams.categories.name,
    starts_at: e.starts_at,
  }));
}

/**
 * Tarea 2 — entrenos PASADOS (starts_at < now, SIN límite inferior) de SUS equipos
 * que NO tienen ninguna fila en `training_attendance`. Orden: más reciente primero.
 */
export async function listStaffTrainingsWithoutAttendanceFromClient(
  supabase: DbClient,
  params: { teamIds: string[]; nowMs?: number },
): Promise<StaffPendingTraining[]> {
  const { teamIds } = params;
  if (teamIds.length === 0) return [];
  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();

  const { data: rawEvents } = await supabase
    .from('events')
    .select('id, team_id, starts_at, teams!inner(name, color, categories!inner(name))')
    .in('team_id', teamIds)
    .eq('type', 'training')
    // Cancelado o pendiente/rechazado no cuenta (paridad con asistencia/dirección).
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .lt('starts_at', nowIso)
    .order('starts_at', { ascending: false })
    .limit(SEASON_SAFE_LIMIT);

  const events = (rawEvents ?? []) as unknown as EventRow[];
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const marked = new Set((attRows ?? []).map((r) => r.event_id as string));

  return toPending(events.filter((e) => !marked.has(e.id)));
}

/**
 * Tarea 3 — entrenos a menos de 24 h (now < starts_at ≤ now+24h) de SUS equipos que
 * NO tienen sesión real vinculada. Orden: el más próximo primero.
 */
export async function listStaffTrainingsWithoutSessionFromClient(
  supabase: DbClient,
  params: { teamIds: string[]; nowMs?: number },
): Promise<StaffPendingTraining[]> {
  const { teamIds } = params;
  if (teamIds.length === 0) return [];
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const untilIso = new Date(nowMs + WITHOUT_SESSION_WINDOW_MS).toISOString();

  const { data: rawEvents } = await supabase
    .from('events')
    .select('id, team_id, starts_at, teams!inner(name, color, categories!inner(name))')
    .in('team_id', teamIds)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .gt('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true })
    .limit(SEASON_SAFE_LIMIT);

  const events = (rawEvents ?? []) as unknown as EventRow[];
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const { data: sessRows } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('is_template', false);
  const planned = new Set(
    (sessRows ?? [])
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => id != null),
  );

  return toPending(events.filter((e) => !planned.has(e.id)));
}
