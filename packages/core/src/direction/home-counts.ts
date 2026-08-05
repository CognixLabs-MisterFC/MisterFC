/**
 * O2-11a-2 — Conteos del INICIO DE DIRECCIÓN (nativa), club-wide y SOLO LECTURA.
 *
 * Espeja, en un único read de core, los conteos que la web calcula en la página
 * `direccion-home.tsx` a partir de sus loaders (`direccion-home-queries.ts`,
 * `training-alert-queries.ts`, `campaign-alert-queries.ts`). La web muestra LISTAS
 * con deep-link por ítem; la app de dirección solo necesita los CONTEOS + un
 * deep-link por cola. Los dos conteos puramente-contables (invitaciones, supresiones)
 * se extraen a helpers que la web reusa (wrapper); el resto se replica aquí para la
 * rama admin/director (club-wide, sin el filtro por equipo/entrenador de la web).
 *
 * Las ACCIONES (aprobar festivo, decidir supresión) son 11c — aquí SOLO el número.
 * Gate de la banda = `AreaGuard('direction')`; estos reads no gatean por rol. Las
 * supresiones solo se piden cuando el caller es admin_club (paridad con la web, que
 * solo cuenta erasures para `isAdminClub`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MATCH_SURFACE_TYPES } from '../events/types';
import {
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
} from '../development-report/development-report';

type DbClient = SupabaseClient<Database>;

const TRAINING_WINDOW_HOURS = 48;
const ATTENDANCE_LOOKBACK_HOURS = 72;
const CALLUP_HORIZON_DAYS = 60;

export type DireccionHomeCounts = {
  // ── Bloque 1 · Tareas de DIRECCIÓN (sin filtro) ──
  /** Invitaciones del club pendientes (sin aceptar, no expiradas). */
  pendingInvitations: number;
  /** Supresiones (derecho al olvido) pendientes. 0 si el caller no es admin_club. */
  pendingErasures: number;
  /** Entrenamientos en festivo PENDIENTES de aprobar. */
  pendingApprovals: number;
  // ── Bloque 2 · Tareas de los ENTRENADORES (club-wide) ──
  /** Entrenamientos (<48h) SIN sesión planificada. */
  trainingsWithoutSession: number;
  /** Entrenamientos pasados (<72h) SIN asistencia marcada. */
  trainingsWithoutAttendance: number;
  /** Convocatorias de partido (hasta +60d) SIN publicar. */
  pendingCallups: number;
  /** Informes de desarrollo pendientes (Σ sobre las campañas lanzadas). */
  pendingReports: number;
};

/** Invitaciones del club pendientes (sin aceptar y no expiradas). */
export async function countPendingInvitationsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso);
  return count ?? 0;
}

/** Supresiones (derecho al olvido) del club pendientes de aprobar. */
export async function countPendingErasuresFromClient(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const { count } = await supabase
    .from('erasure_requests')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('status', 'pending');
  return count ?? 0;
}

/** Entrenamientos en festivo pendientes de aprobar (cola de dirección). */
async function countPendingApprovals(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const { count } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('type', 'training')
    .eq('approval_status', 'pending');
  return count ?? 0;
}

/** Entrenamientos de equipo (<48h) que aún no tienen sesión real vinculada. */
async function countTrainingsWithoutSession(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + TRAINING_WINDOW_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gt('starts_at', nowIso)
    .lte('starts_at', untilIso);
  const eventIds = (evRows ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) return 0;

  const { data: sessRows } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('is_template', false);
  const planned = new Set(
    (sessRows ?? [])
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => id != null)
  );
  return eventIds.filter((id) => !planned.has(id)).length;
}

/** Entrenamientos pasados (<72h) sin ninguna fila de asistencia. */
async function countTrainingsWithoutAttendance(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const fromIso = new Date(
    Date.now() - ATTENDANCE_LOOKBACK_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gte('starts_at', fromIso)
    .lte('starts_at', nowIso);
  const eventIds = (evRows ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) return 0;

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const marked = new Set((attRows ?? []).map((r) => r.event_id as string));
  return eventIds.filter((id) => !marked.has(id)).length;
}

/** Convocatorias de partido (hasta +60d) sin `match_callup_meta.published_at`. */
async function countPendingCallups(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + CALLUP_HORIZON_DAYS * 86_400_000
  ).toISOString();

  const { data } = await supabase
    .from('events')
    .select('id, match_callup_meta(published_at)')
    .eq('club_id', clubId)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', untilIso);

  type Row = {
    id: string;
    match_callup_meta:
      | { published_at: string | null }
      | { published_at: string | null }[]
      | null;
  };
  return ((data ?? []) as unknown as Row[]).filter((e) => {
    const m = e.match_callup_meta;
    if (!m) return true;
    if (Array.isArray(m)) return m.length === 0 || !m[0]?.published_at;
    return !m.published_at;
  }).length;
}

/**
 * Σ de informes de desarrollo pendientes sobre las campañas LANZADAS de la
 * temporada activa (roster activo club-wide sin informe completado). Espeja la
 * rama admin de `loadCampaignAlerts`.
 */
async function countPendingReports(
  supabase: DbClient,
  clubId: string
): Promise<number> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return 0;
  const seasonId = season.id as string;
  const seasonLabel = season.label as string;

  const { data: campaignRows } = await supabase
    .from('assessment_campaigns')
    .select('period, due_date, status')
    .eq('season_id', seasonId)
    .eq('status', 'launched');
  const periods = ((campaignRows ?? []) as Array<{
    period: string;
    due_date: string | null;
  }>)
    .filter((c) => c.due_date)
    .map((c) => c.period);
  if (periods.length === 0) return 0;

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('season', seasonLabel)
    .eq('categories.club_id', clubId);
  const teamIds = ((teamRows ?? []) as unknown as Array<{ id: string }>).map(
    (t) => t.id
  );
  if (teamIds.length === 0) return 0;

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('player_id')
    .in('team_id', teamIds)
    .is('left_at', null);
  const rosterIds = new Set((rosterRows ?? []).map((r) => r.player_id as string));
  const total = rosterIds.size;
  if (total === 0) return 0;

  const { data: reportRows } = await supabase
    .from('development_reports')
    .select('player_id, period, scores')
    .eq('season_id', seasonId)
    .in('team_id', teamIds)
    .in('period', periods);
  const completedByPeriod = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    player_id: string;
    period: string;
    scores: Record<string, number>;
  }>) {
    if (
      rosterIds.has(r.player_id) &&
      reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed'
    ) {
      const set = completedByPeriod.get(r.period) ?? new Set<string>();
      set.add(r.player_id);
      completedByPeriod.set(r.period, set);
    }
  }

  let pending = 0;
  for (const period of periods) {
    const done = completedByPeriod.get(period)?.size ?? 0;
    const p = total - done;
    if (p > 0) pending += p;
  }
  return pending;
}

/**
 * Todos los conteos del Inicio de dirección. `opts.includeErasures` refleja el
 * gate de la web (solo admin_club cuenta supresiones; el director no las ve).
 */
export async function getDireccionHomeCountsFromClient(
  supabase: DbClient,
  clubId: string,
  opts: { includeErasures: boolean }
): Promise<DireccionHomeCounts> {
  const [
    pendingInvitations,
    pendingErasures,
    pendingApprovals,
    trainingsWithoutSession,
    trainingsWithoutAttendance,
    pendingCallups,
    pendingReports,
  ] = await Promise.all([
    countPendingInvitationsFromClient(supabase, clubId),
    opts.includeErasures
      ? countPendingErasuresFromClient(supabase, clubId)
      : Promise.resolve(0),
    countPendingApprovals(supabase, clubId),
    countTrainingsWithoutSession(supabase, clubId),
    countTrainingsWithoutAttendance(supabase, clubId),
    countPendingCallups(supabase, clubId),
    countPendingReports(supabase, clubId),
  ]);

  return {
    pendingInvitations,
    pendingErasures,
    pendingApprovals,
    trainingsWithoutSession,
    trainingsWithoutAttendance,
    pendingCallups,
    pendingReports,
  };
}
