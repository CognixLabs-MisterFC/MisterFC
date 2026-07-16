/**
 * F14E-2 — Datos del Inicio de DIRECCIÓN (admin_club/director; superadmin entra
 * como admin_club). Agrega, club-wide, las tareas pendientes de los entrenadores
 * (mismo contenido que ve un entrenador en su Inicio) + tareas de gestión
 * (invitaciones, supresiones), con filtros por equipo y por entrenador.
 *
 * Reutiliza los loaders existentes donde ya son club-wide (loadTrainingsWithoutSession,
 * loadCampaignAlerts) y extrae aquí, club-wide, la lógica que en el Home del coach
 * estaba inline: convocatorias sin publicar (page.tsx) y asistencia sin confirmar
 * (signal last_training_without_attendance de loadTeamDetail).
 *
 * Acceso: admin_club ya lee todo club-wide; el DIRECTOR gana el mismo acceso por
 * la migración 20261005000000 (Opción A). No se añade RLS aquí.
 */

import {
  createSupabaseServerClient,
  MATCH_SURFACE_TYPES,
  teamsInActiveSeason,
  COACH_ROLES as CORE_COACH_ROLES,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

const COACH_ROLES = new Set<string>(CORE_COACH_ROLES);

export type DireccionTaskItem = {
  eventId: string;
  title: string;
  startsAt: string;
  teamName: string | null;
};

export type TeamOption = { id: string; name: string };
export type CoachOption = { membershipId: string; name: string };

export type DireccionFilters = {
  teamId?: string;
  coachMembershipId?: string;
};

/**
 * Traduce los filtros (equipo / entrenador) a la lista de team_ids que acota las
 * tareas. `null` = sin filtro (todo el club). Entrenador → sus equipos (team_staff);
 * equipo → ese equipo; ambos → intersección; ninguno → null.
 */
export async function resolveFilterTeamIds(
  filters: DireccionFilters
): Promise<string[] | null> {
  const { teamId, coachMembershipId } = filters;
  if (!teamId && !coachMembershipId) return null;

  let coachTeamIds: string[] | null = null;
  if (coachMembershipId) {
    const supabase = createSupabaseServerClient(await createCookieAdapter());
    const { data } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', coachMembershipId)
      .is('left_at', null);
    coachTeamIds = (data ?? []).map((r) => r.team_id as string);
  }

  if (teamId && coachTeamIds) {
    return coachTeamIds.includes(teamId) ? [teamId] : [];
  }
  if (coachTeamIds) return coachTeamIds;
  return teamId ? [teamId] : null;
}

/** Equipos (temporada activa) y entrenadores del club para poblar los filtros. */
export async function loadFilterOptions(
  clubId: string
): Promise<{ teams: TeamOption[]; coaches: CoachOption[] }> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, season, categories!inner(club_id)')
    .order('name');
  type TeamRow = { id: string; name: string; season: string; categories: { club_id: string } };
  const allTeams = ((teamRows ?? []) as unknown as TeamRow[])
    .filter((t) => t.categories.club_id === clubId)
    .map((t) => ({ id: t.id, name: t.name, season: t.season }));
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const teams: TeamOption[] = teamsInActiveSeason(allTeams, activeSeason).map(
    (t) => ({ id: t.id, name: t.name })
  );

  const { data: staffRows } = await supabase
    .from('team_staff')
    .select('membership_id, memberships!inner(id, role, club_id, profiles!inner(full_name))')
    .is('left_at', null);
  type StaffRow = {
    membership_id: string;
    memberships: { id: string; role: string; club_id: string; profiles: { full_name: string } };
  };
  const byMembership = new Map<string, CoachOption>();
  for (const r of (staffRows ?? []) as unknown as StaffRow[]) {
    const m = r.memberships;
    if (m.club_id === clubId && COACH_ROLES.has(m.role) && !byMembership.has(m.id)) {
      byMembership.set(m.id, {
        membershipId: m.id,
        name: m.profiles.full_name,
      });
    }
  }
  const coaches = [...byMembership.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );

  return { teams, coaches };
}

/**
 * D — Convocatorias de partido SIN publicar, club-wide. Extrae la lógica inline
 * del Home del coach (page.tsx): partidos (match/friendly) futuros (hasta +60d)
 * sin `match_callup_meta.published_at`.
 */
export async function loadPendingCallups(
  clubId: string,
  filterTeamIds?: string[] | null
): Promise<DireccionTaskItem[]> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + 60 * 86_400_000).toISOString();

  let q = supabase
    .from('events')
    .select('id, title, starts_at, team_id, teams(name), match_callup_meta(published_at)')
    .eq('club_id', clubId)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });
  if (filterTeamIds && filterTeamIds.length > 0) q = q.in('team_id', filterTeamIds);

  type Row = {
    id: string;
    title: string;
    starts_at: string;
    teams: { name: string } | null;
    match_callup_meta:
      | { published_at: string | null }
      | { published_at: string | null }[]
      | null;
  };
  const { data } = await q;
  return ((data ?? []) as unknown as Row[])
    .filter((e) => {
      const m = e.match_callup_meta;
      if (!m) return true;
      if (Array.isArray(m)) return m.length === 0 || !m[0]?.published_at;
      return !m.published_at;
    })
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      startsAt: e.starts_at,
      teamName: e.teams?.name ?? null,
    }));
}

/**
 * E — Asistencia SIN confirmar, club-wide. Versión club del signal
 * last_training_without_attendance (loadTeamDetail): entrenamientos YA pasados en
 * las últimas 72h que NO tienen ninguna fila en `training_attendance`.
 */
export async function loadTrainingsWithoutAttendance(
  clubId: string,
  filterTeamIds?: string[] | null
): Promise<DireccionTaskItem[]> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const nowIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 72 * 3_600_000).toISOString();

  let q = supabase
    .from('events')
    .select('id, title, starts_at, team_id, teams(name)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    // F14F-1b — un entreno cancelado no queda "pendiente de asistencia".
    .is('cancelled_at', null)
    // F14F-4 — ni un pendiente/rechazado (no es un entreno confirmado).
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gte('starts_at', fromIso)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending: false });
  if (filterTeamIds && filterTeamIds.length > 0) q = q.in('team_id', filterTeamIds);

  type Row = {
    id: string;
    title: string;
    starts_at: string;
    teams: { name: string } | null;
  };
  const events = ((await q).data ?? []) as unknown as Row[];
  if (events.length === 0) return [];

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', events.map((e) => e.id));
  const marked = new Set((attRows ?? []).map((r) => r.event_id as string));

  return events
    .filter((e) => !marked.has(e.id))
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      startsAt: e.starts_at,
      teamName: e.teams?.name ?? null,
    }));
}

/**
 * F14F-4 — COLA de trainings PENDIENTES de aprobación (creados en día festivo
 * por alguien que no puede aprobar). Solo dirección/admin la usa. Ordenada por
 * fecha del entrenamiento.
 */
export async function loadPendingApprovals(
  clubId: string,
  filterTeamIds?: string[] | null
): Promise<DireccionTaskItem[]> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  let q = supabase
    .from('events')
    .select('id, title, starts_at, team_id, teams(name)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .eq('approval_status', 'pending')
    .order('starts_at', { ascending: true });
  if (filterTeamIds && filterTeamIds.length > 0) q = q.in('team_id', filterTeamIds);

  type Row = {
    id: string;
    title: string;
    starts_at: string;
    teams: { name: string } | null;
  };
  const events = ((await q).data ?? []) as unknown as Row[];
  return events.map((e) => ({
    eventId: e.id,
    title: e.title,
    startsAt: e.starts_at,
    teamName: e.teams?.name ?? null,
  }));
}

/** Invitaciones del club pendientes (sin aceptar y no expiradas). */
export async function loadPendingInvitationsCount(clubId: string): Promise<number> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
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
export async function loadPendingErasureCount(clubId: string): Promise<number> {
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const { count } = await supabase
    .from('erasure_requests')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('status', 'pending');
  return count ?? 0;
}
