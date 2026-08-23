/**
 * D2-1 — LISTAS club-wide de las colas de eventos del inicio de dirección (SOLO
 * LECTURA). Espejan, fila a fila, los MISMOS conteos que `home-counts.ts` calcula
 * para los badges del inicio (`getDireccionHomeCountsFromClient`): aquí, en vez del
 * número, se devuelven las filas enriquecidas (título, fecha, equipo) para pintar la
 * lista y cablear cada fila a su detalle read-only de dirección. Los helpers de
 * conteo de `home-counts.ts` NO se tocan (el badge del inicio sigue igual).
 *
 * Mismas tablas y filas que los conteos que YA corren hoy para el director (events,
 * sessions, training_attendance, match_callup_meta, teams): solo se piden más
 * columnas de filas ya legibles. Sin superficie RLS nueva. Club-wide por `clubId`;
 * nada atado a team_staff/membership. Las ACCIONES quedan fuera (solo consulta).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MATCH_SURFACE_TYPES } from '../events/types';

type DbClient = SupabaseClient<Database>;

// Mismas ventanas que `home-counts.ts` (paridad con los conteos del inicio).
const TRAINING_WINDOW_HOURS = 48;
const ATTENDANCE_LOOKBACK_HOURS = 72;
const CALLUP_HORIZON_DAYS = 60;

/**
 * Fila de una cola de eventos pendientes. Lleva justo lo que `directionEventTarget`
 * necesita para enrutar (`id`, `type`, `title`, `starts_at`, `location_name`,
 * `has_session`) más lo que pinta la fila (`opponent_name`, `team_name`,
 * `team_color`).
 */
export type DireccionPendingEvent = {
  id: string;
  type: string;
  title: string;
  starts_at: string;
  location_name: string | null;
  opponent_name: string | null;
  team_name: string | null;
  team_color: string | null;
  has_session: boolean;
};

/** Join `teams(name, color)` de PostgREST: objeto, array o null (el generador no lo estrecha). */
type RawTeam = { name: string; color: string } | { name: string; color: string }[] | null;

function teamOf(raw: unknown): { name: string | null; color: string | null } {
  const team = raw as RawTeam;
  const t = Array.isArray(team) ? (team[0] ?? null) : team;
  return { name: t?.name ?? null, color: t?.color ?? null };
}

/** Set de event_ids con sesión real (no plantilla) vinculada, entre los dados. */
async function plannedEventIds(
  supabase: DbClient,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('is_template', false);
  return new Set(
    (data ?? [])
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => id != null)
  );
}

/**
 * Entrenamientos de equipo (<48h futuros) SIN sesión vinculada. Espeja
 * `countTrainingsWithoutSession`; `has_session` es siempre false (por definición).
 * Detalle: `directionEventTarget` → `/direction/entrenamiento`.
 */
export async function listTrainingsWithoutSessionFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + TRAINING_WINDOW_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id, type, title, starts_at, location_name, teams(name, color)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gt('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });

  const rows = evRows ?? [];
  const planned = await plannedEventIds(
    supabase,
    rows.map((e) => e.id as string)
  );
  return rows
    .filter((e) => !planned.has(e.id as string))
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id as string,
        type: e.type as string,
        title: (e.title as string) ?? '',
        starts_at: e.starts_at as string,
        location_name: (e.location_name as string | null) ?? null,
        opponent_name: null,
        team_name: name,
        team_color: color,
        has_session: false,
      };
    });
}

/**
 * Entrenamientos pasados (<72h) SIN ninguna fila de asistencia. Espeja
 * `countTrainingsWithoutAttendance`. Se calcula `has_session` para que
 * `directionEventTarget` lleve al visor de sesión (`/direction/sesion?eventId`, que
 * resuelve el id y cae al detalle de entreno si no) o, sin sesión, al detalle.
 */
export async function listPastTrainingsWithoutAttendanceFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const fromIso = new Date(
    Date.now() - ATTENDANCE_LOOKBACK_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id, type, title, starts_at, location_name, teams(name, color)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gte('starts_at', fromIso)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending: false });

  const rows = evRows ?? [];
  const eventIds = rows.map((e) => e.id as string);
  if (eventIds.length === 0) return [];

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const marked = new Set((attRows ?? []).map((r) => r.event_id as string));
  const planned = await plannedEventIds(supabase, eventIds);

  return rows
    .filter((e) => !marked.has(e.id as string))
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id as string,
        type: e.type as string,
        title: (e.title as string) ?? '',
        starts_at: e.starts_at as string,
        location_name: (e.location_name as string | null) ?? null,
        opponent_name: null,
        team_name: name,
        team_color: color,
        has_session: planned.has(e.id as string),
      };
    });
}

/**
 * Partidos (hasta +60d) SIN `match_callup_meta.published_at`. Espeja
 * `countPendingCallups` (mismos `MATCH_SURFACE_TYPES`). Detalle:
 * `directionEventTarget` → `/direction/convocatoria` read-only.
 */
export async function listPendingCallupsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + CALLUP_HORIZON_DAYS * 86_400_000
  ).toISOString();

  const { data } = await supabase
    .from('events')
    .select(
      'id, type, title, starts_at, opponent_name, teams(name, color), match_callup_meta(published_at)'
    )
    .eq('club_id', clubId)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });

  type Row = {
    id: string;
    type: string;
    title: string;
    starts_at: string;
    opponent_name: string | null;
    teams: unknown;
    match_callup_meta:
      | { published_at: string | null }
      | { published_at: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((e) => {
      const m = e.match_callup_meta;
      if (!m) return true;
      if (Array.isArray(m)) return m.length === 0 || !m[0]?.published_at;
      return !m.published_at;
    })
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id,
        type: e.type,
        title: e.title ?? '',
        starts_at: e.starts_at,
        location_name: null,
        opponent_name: e.opponent_name ?? null,
        team_name: name,
        team_color: color,
        has_session: false,
      };
    });
}
