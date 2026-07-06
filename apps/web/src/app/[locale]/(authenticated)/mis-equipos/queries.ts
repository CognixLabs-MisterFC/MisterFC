/**
 * Queries del hub /mis-equipos (lista) y /mis-equipos/[teamId] (detalle).
 *
 * Permisos:
 *  - Solo entrenador_principal y entrenador_ayudante ven /mis-equipos.
 *  - Cada coach ve solo los teams en los que tiene `team_staff` activo.
 *
 * Esta pieza es lectura. Las acciones (publicar convocatoria, marcar
 * asistencia, etc.) siguen viviendo en sus rutas propias y se enlazan
 * desde aquí.
 */

import {
  callupEventIdFor,
  createSupabaseServerClient,
  isMatchSurfaceType,
  pickNextEvent,
  pickNextMatchWithoutCallup,
  pickLastTrainingWithoutAttendance,
  COACH_ROLES,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

export type CoachTeamCard = {
  team_id: string;
  team_name: string;
  team_color: string;
  team_format: string;
  category_name: string;
  category_season: string;
  staff_role: 'entrenador_principal' | 'entrenador_ayudante';
  players_count: number;
  next_training_at: string | null;
  next_match_at: string | null;
  next_match_opponent: string | null;
};

export type TeamRosterRow = {
  team_member_id: string;
  player_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  dorsal: number | null;
  dorsal_in_team: number | null;
  position_main: string | null;
  position_in_team: string | null;
};

export type TeamUpcomingEvent = {
  id: string;
  type: 'training' | 'match' | 'friendly';
  title: string;
  starts_at: string;
  opponent_name: string | null;
  has_callup_published: boolean;
};

export type TeamDetail = {
  team: {
    id: string;
    name: string;
    color: string;
    format: string;
    category_id: string;
    category_name: string;
    category_season: string;
  };
  staff_role: 'entrenador_principal' | 'entrenador_ayudante';
  roster: TeamRosterRow[];
  upcoming_events: TeamUpcomingEvent[];
  next_match_without_callup: TeamUpcomingEvent | null;
  last_training_without_attendance: TeamUpcomingEvent | null;
  callups_published_count: number;
};

const STAFF_ROLES = new Set<string>(COACH_ROLES);

type StaffTeam = {
  team_id: string;
  staff_role: string;
  teams: {
    id: string;
    name: string;
    color: string;
    format: string;
    season: string;
    categories: {
      id: string;
      club_id: string;
      name: string;
    };
  };
};

async function loadStaffTeams(
  membershipId: string,
  clubId: string
): Promise<StaffTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data } = await supabase
    .from('team_staff')
    .select(
      'team_id, staff_role, teams!inner(id, name, color, format, season, categories!inner(id, club_id, name))'
    )
    .eq('membership_id', membershipId)
    .is('left_at', null);
  return ((data ?? []) as unknown as StaffTeam[]).filter(
    (s) =>
      STAFF_ROLES.has(s.staff_role) && s.teams.categories.club_id === clubId
  );
}

export async function loadCoachTeams(
  membershipId: string,
  clubId: string
): Promise<CoachTeamCard[]> {
  const allStaffTeams = await loadStaffTeams(membershipId, clubId);
  if (allStaffTeams.length === 0) return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Bug-1: el hub del entrenador es operativo → solo equipos de la temporada
  // activa (sin duplicados del rollover). La ficha de un equipo concreto
  // (loadTeamDetail) sigue siendo accesible aunque sea de otra temporada.
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const staffTeams = allStaffTeams.filter(
    (s) => s.teams.season === activeSeason
  );
  if (staffTeams.length === 0) return [];
  const teamIds = staffTeams.map((s) => s.team_id);

  const nowIso = new Date().toISOString();
  const horizonIso = new Date(
    Date.now() + 60 * 86_400_000
  ).toISOString();

  type TM = { team_id: string; player_id: string; left_at: string | null };
  type EventShape = {
    id: string;
    team_id: string;
    type: 'training' | 'match' | 'friendly';
    title: string;
    opponent_name: string | null;
    starts_at: string;
  };

  const [{ data: tmRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from('team_members')
      .select('team_id, player_id, left_at')
      .in('team_id', teamIds)
      .is('left_at', null),
    supabase
      .from('events')
      .select('id, team_id, type, title, opponent_name, starts_at')
      .in('team_id', teamIds)
      .gte('starts_at', nowIso)
      .lte('starts_at', horizonIso)
      .order('starts_at', { ascending: true }),
  ]);

  const playersByTeam = new Map<string, number>();
  for (const r of ((tmRows ?? []) as unknown[]) as TM[]) {
    playersByTeam.set(r.team_id, (playersByTeam.get(r.team_id) ?? 0) + 1);
  }

  const eventsByTeam = new Map<string, EventShape[]>();
  for (const e of ((eventRows ?? []) as unknown[]) as EventShape[]) {
    const list = eventsByTeam.get(e.team_id) ?? [];
    list.push(e);
    eventsByTeam.set(e.team_id, list);
  }

  return staffTeams.map((s) => {
    const teamEvents = eventsByTeam.get(s.team_id) ?? [];
    const nextTraining = pickNextEvent(
      teamEvents,
      nowIso,
      (e) => e.type === 'training'
    );
    const nextMatch = pickNextEvent(
      teamEvents,
      nowIso,
      // F13B — el amistoso también es "próximo partido".
      (e) => isMatchSurfaceType(e.type)
    );
    return {
      team_id: s.team_id,
      team_name: s.teams.name,
      team_color: s.teams.color,
      team_format: s.teams.format,
      category_name: s.teams.categories.name,
      category_season: s.teams.season,
      staff_role: s.staff_role as
        | 'entrenador_principal'
        | 'entrenador_ayudante',
      players_count: playersByTeam.get(s.team_id) ?? 0,
      next_training_at: nextTraining?.starts_at ?? null,
      next_match_at: nextMatch?.starts_at ?? null,
      next_match_opponent: nextMatch?.opponent_name ?? null,
    };
  });
}

export async function loadTeamDetail(
  membershipId: string,
  clubId: string,
  teamId: string
): Promise<TeamDetail | null> {
  const staffTeams = await loadStaffTeams(membershipId, clubId);
  const staff = staffTeams.find((s) => s.team_id === teamId);
  if (!staff) return null;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const nowIso = new Date().toISOString();
  const horizonIso = new Date(
    Date.now() + 60 * 86_400_000
  ).toISOString();
  const lookbackIso = new Date(
    Date.now() - 7 * 86_400_000
  ).toISOString();

  type RosterShape = {
    id: string;
    dorsal_in_team: number | null;
    position_in_team: string | null;
    joined_at: string;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
      dorsal: number | null;
      position_main: string | null;
    };
  };

  type EventShape = {
    id: string;
    type: 'training' | 'match' | 'friendly';
    title: string;
    opponent_name: string | null;
    starts_at: string;
    tournament_id: string | null;
  };

  type MetaShape = { event_id: string; published_at: string | null };
  type AttendanceShape = { event_id: string };

  const [
    { data: rosterRows },
    { data: futureEvents },
    { data: pastTrainings },
  ] = await Promise.all([
    supabase
      .from('team_members')
      .select(
        'id, dorsal_in_team, position_in_team, joined_at, players!inner(id, first_name, last_name, date_of_birth, dorsal, position_main)'
      )
      .eq('team_id', teamId)
      .is('left_at', null),
    supabase
      .from('events')
      .select('id, type, title, opponent_name, starts_at, tournament_id')
      .eq('team_id', teamId)
      .gte('starts_at', nowIso)
      .lte('starts_at', horizonIso)
      .order('starts_at', { ascending: true }),
    supabase
      .from('events')
      .select('id, type, title, opponent_name, starts_at, tournament_id')
      .eq('team_id', teamId)
      .eq('type', 'training')
      .gte('starts_at', lookbackIso)
      .lte('starts_at', nowIso),
  ]);

  const roster = ((rosterRows ?? []) as unknown[]) as RosterShape[];
  const future = ((futureEvents ?? []) as unknown[]) as EventShape[];
  const past = ((pastTrainings ?? []) as unknown[]) as EventShape[];

  // F13B — amistoso también tiene convocatoria; y un partido de TORNEO la hereda
  // de la cabecera (callupEventIdFor). Consultamos la meta por el evento FUENTE.
  const futureCallupIds = Array.from(
    new Set(
      future
        .filter((e) => isMatchSurfaceType(e.type))
        .map((e) => callupEventIdFor(e)),
    ),
  );
  const pastTrainingIds = past.map((e) => e.id);

  const [{ data: metas }, { data: attendances }] = await Promise.all([
    futureCallupIds.length === 0
      ? { data: [] as MetaShape[] }
      : supabase
          .from('match_callup_meta')
          .select('event_id, published_at')
          .in('event_id', futureCallupIds),
    pastTrainingIds.length === 0
      ? { data: [] as AttendanceShape[] }
      : supabase
          .from('training_attendance')
          .select('event_id')
          .in('event_id', pastTrainingIds),
  ]);

  const publishedSet = new Set<string>();
  for (const m of (metas ?? []) as MetaShape[]) {
    if (m.published_at != null) publishedSet.add(m.event_id);
  }
  const attendanceSet = new Set<string>();
  for (const a of (attendances ?? []) as AttendanceShape[]) {
    attendanceSet.add(a.event_id);
  }

  const upcoming: TeamUpcomingEvent[] = future.map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    starts_at: e.starts_at,
    opponent_name: e.opponent_name,
    has_callup_published:
      isMatchSurfaceType(e.type)
        ? publishedSet.has(callupEventIdFor(e))
        : false,
  }));

  const nextMatchPick = pickNextMatchWithoutCallup(
    future,
    nowIso,
    publishedSet
  );
  const nextMatchWithoutCallup =
    nextMatchPick == null
      ? null
      : upcoming.find((u) => u.id === nextMatchPick.id) ?? null;

  const pastEventsForHelper = past.map((e) => ({ ...e }));
  const lastTrainingPick = pickLastTrainingWithoutAttendance(
    pastEventsForHelper,
    nowIso,
    72,
    attendanceSet
  );
  const lastTrainingWithoutAttendance =
    lastTrainingPick == null
      ? null
      : {
          id: lastTrainingPick.id,
          type: 'training' as const,
          title: lastTrainingPick.title,
          starts_at: lastTrainingPick.starts_at,
          opponent_name: lastTrainingPick.opponent_name,
          has_callup_published: false,
        };

  roster.sort((a, b) =>
    (a.players.last_name ?? '').localeCompare(b.players.last_name ?? '', 'es', {
      sensitivity: 'base',
    })
  );

  return {
    team: {
      id: staff.team_id,
      name: staff.teams.name,
      color: staff.teams.color,
      format: staff.teams.format,
      category_id: staff.teams.categories.id,
      category_name: staff.teams.categories.name,
      category_season: staff.teams.season,
    },
    staff_role: staff.staff_role as
      | 'entrenador_principal'
      | 'entrenador_ayudante',
    roster: roster.map((r) => ({
      team_member_id: r.id,
      player_id: r.players.id,
      first_name: r.players.first_name,
      last_name: r.players.last_name,
      date_of_birth: r.players.date_of_birth,
      dorsal: r.players.dorsal,
      dorsal_in_team: r.dorsal_in_team,
      position_main: r.players.position_main,
      position_in_team: r.position_in_team,
    })),
    upcoming_events: upcoming,
    next_match_without_callup: nextMatchWithoutCallup,
    last_training_without_attendance: lastTrainingWithoutAttendance,
    callups_published_count: publishedSet.size,
  };
}
