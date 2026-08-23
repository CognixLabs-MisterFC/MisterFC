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
import {
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
} from '../development-report/development-report';

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

// ─────────────────────────────────────────────────────────────────────────────
//  D2-2 · Listas TERMINALES (sin detalle): invitaciones + progreso de informes.
// ─────────────────────────────────────────────────────────────────────────────

/** Fila de la lista de invitaciones pendientes (informativa, sin navegación). */
export type DireccionPendingInvitation = {
  id: string;
  email: string;
  role: string;
  team_name: string | null;
  expires_at: string;
};

/**
 * Invitaciones del club sin aceptar y no expiradas. Espeja el filtro de
 * `countPendingInvitationsFromClient` (mismas filas), pero devuelve las columnas para
 * pintar cada fila: a quién (email), rol, equipo (si la invitación va atada a uno) y
 * caducidad. La RLS `invitations_select` ya deja al director ver todas las del club
 * (mig f14k_1). Sin acciones (solo consulta).
 */
export async function listPendingInvitationsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingInvitation[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('invitations')
    .select('id, email, role, expires_at, teams(name)')
    .eq('club_id', clubId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: true });

  return (data ?? []).map((r) => {
    const { name } = teamOf(r.teams);
    return {
      id: r.id as string,
      email: r.email as string,
      role: r.role as string,
      team_name: name,
      expires_at: r.expires_at as string,
    };
  });
}

/** Fila del progreso de informes de UN equipo en UNA campaña (informativa). */
export type DireccionTeamReportProgress = {
  teamId: string;
  team_name: string;
  category_name: string | null;
  period: string;
  done: number;
  total: number;
};

/**
 * Progreso de informes POR EQUIPO Y CAMPAÑA de la temporada activa (roster activo vs
 * informes completados). Desglosa por equipo lo que `countPendingReports` sumaba en un
 * solo número: una fila por (equipo × campaña lanzada) con informes pendientes
 * (`done < total`) — "a qué entrenador apretar". NO lista jugadores. Mismas tablas y
 * criterio (`reportStatus`) que el conteo del inicio; `development_reports_select` ya
 * da al director lectura club-wide (mig c1b). Sin acciones.
 */
export async function listTeamsReportProgressFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionTeamReportProgress[]> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return [];
  const seasonId = season.id as string;
  const seasonLabel = season.label as string;

  const { data: campaignRows } = await supabase
    .from('assessment_campaigns')
    .select('period, due_date, status')
    .eq('season_id', seasonId)
    .eq('status', 'launched');
  const periods = [
    ...new Set(
      ((campaignRows ?? []) as Array<{ period: string; due_date: string | null }>)
        .filter((c) => c.due_date)
        .map((c) => c.period)
    ),
  ];
  if (periods.length === 0) return [];

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, categories!inner(name, club_id)')
    .eq('season', seasonLabel)
    .eq('categories.club_id', clubId);
  const teams = ((teamRows ?? []) as unknown as Array<{
    id: string;
    name: string;
    categories: { name: string; club_id: string } | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.categories?.name ?? null,
  }));
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('team_id, player_id')
    .in('team_id', teamIds)
    .is('left_at', null);
  const rosterByTeam = new Map<string, Set<string>>();
  for (const r of (rosterRows ?? []) as Array<{ team_id: string; player_id: string }>) {
    const set = rosterByTeam.get(r.team_id) ?? new Set<string>();
    set.add(r.player_id);
    rosterByTeam.set(r.team_id, set);
  }

  const { data: reportRows } = await supabase
    .from('development_reports')
    .select('team_id, player_id, period, scores')
    .eq('season_id', seasonId)
    .in('team_id', teamIds)
    .in('period', periods);
  const completedByTeamPeriod = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    team_id: string;
    player_id: string;
    period: string;
    scores: Record<string, number>;
  }>) {
    const roster = rosterByTeam.get(r.team_id);
    if (
      roster?.has(r.player_id) &&
      reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed'
    ) {
      const key = `${r.team_id}:${r.period}`;
      const set = completedByTeamPeriod.get(key) ?? new Set<string>();
      set.add(r.player_id);
      completedByTeamPeriod.set(key, set);
    }
  }

  const rows: DireccionTeamReportProgress[] = [];
  for (const team of teams) {
    const total = rosterByTeam.get(team.id)?.size ?? 0;
    if (total === 0) continue;
    for (const period of periods) {
      const done = completedByTeamPeriod.get(`${team.id}:${period}`)?.size ?? 0;
      if (total - done > 0) {
        rows.push({
          teamId: team.id,
          team_name: team.name,
          category_name: team.category,
          period,
          done,
          total,
        });
      }
    }
  }
  // Más pendientes primero (a quién apretar antes); desempate por nombre de equipo.
  rows.sort(
    (a, b) => b.total - b.done - (a.total - a.done) || a.team_name.localeCompare(b.team_name)
  );
  return rows;
}
