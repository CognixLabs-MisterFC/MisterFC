/**
 * F12.8b — Alerta "entrenamiento sin sesión planificada" (<48h) para Inicio.
 *
 * Lee datos existentes (sin migración): events (F3) + sessions (F12.1).
 * Audiencia (D4):
 *   - cuerpo técnico (principal/ayudante): SUS equipos (team_staff activo).
 *   - admin_club / coordinador: todo el club.
 *   - jugador/familia: fuera (no es su tarea) → [].
 * Solo entrenamientos DE EQUIPO (team_id no nulo); categoría/club fuera (como
 * en 12.8). La ventana 48h se evalúa con starts_at server-side.
 */

import {
  createSupabaseServerClient,
  ADMIN_ROLES,
  COACH_ROLES as CORE_COACH_ROLES,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type TrainingWithoutSession = {
  eventId: string;
  title: string;
  startsAt: string;
  teamId: string | null;
  teamName: string | null;
};

const COACH_ROLES = new Set<string>(CORE_COACH_ROLES);
const ADMIN_LIKE_ROLES = new Set<string>(ADMIN_ROLES);

const WINDOW_HOURS = 48;

/**
 * Entrenamientos de equipo en la ventana (ahora, ahora+48h] que AÚN no tienen
 * sesión vinculada. Dos pasos (espeja loadPlannedEventIds de 12.9): se listan los
 * trainings de la audiencia y se descartan los que ya tienen sesión real. La RLS
 * de `sessions` es coherente: la audiencia (staff) ve todas las del club, así que
 * "sin sesión visible" = "sin sesión".
 */
export async function loadTrainingsWithoutSession(
  role: string,
  clubId: string,
  membershipId: string,
  // F14E-2 — filtro opcional por equipo (Inicio de dirección). Solo acota la rama
  // admin/coord/director club-wide; la rama coach ignora este parámetro.
  filterTeamIds?: string[] | null
): Promise<TrainingWithoutSession[]> {
  const isCoach = COACH_ROLES.has(role);
  const isAdminLike = ADMIN_LIKE_ROLES.has(role);
  if (!isCoach && !isAdminLike) return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + WINDOW_HOURS * 3_600_000).toISOString();

  // Eventos training de equipo en la ventana, acotados a la audiencia.
  let q = supabase
    .from('events')
    .select('id, title, starts_at, team_id, teams(name)')
    .eq('type', 'training')
    // F14F-1b — no alertar de "sin sesión" sobre un entreno cancelado.
    .is('cancelled_at', null)
    .not('team_id', 'is', null)
    .gt('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });

  if (isCoach) {
    const { data: staffRows } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', membershipId)
      .is('left_at', null);
    const teamIds = (staffRows ?? []).map((r) => r.team_id as string);
    if (teamIds.length === 0) return [];
    q = q.in('team_id', teamIds);
  } else {
    // admin/coord/director → todo el club (F14E-2: director ya club-wide por RLS).
    q = q.eq('club_id', clubId);
    if (filterTeamIds && filterTeamIds.length > 0) {
      q = q.in('team_id', filterTeamIds);
    }
  }

  const { data: evRows } = await q;
  type EvShape = {
    id: string;
    title: string;
    starts_at: string;
    team_id: string | null;
    teams: { name: string } | null;
  };
  const events = (evRows ?? []) as unknown as EvShape[];
  if (events.length === 0) return [];

  // ¿Cuáles ya tienen sesión real vinculada? (un solo lookup).
  const eventIds = events.map((e) => e.id);
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

  return events
    .filter((e) => !planned.has(e.id))
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      startsAt: e.starts_at,
      teamId: e.team_id,
      teamName: e.teams?.name ?? null,
    }));
}
