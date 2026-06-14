/**
 * F4 Lote B — Queries de convocatorias.
 *
 * Reusa `events` (F3) + `team_members` (F2.5) + las 3 tablas de F4.3.
 *
 * Permisos de lectura:
 *  - admin / coord → todos los partidos del club.
 *  - principal / ayudante → solo los partidos de sus teams (vía team_staff).
 *  - jugador → partidos de sus jugadores vinculados (vía player_accounts).
 */

import {
  type AttendanceCode,
  type AttendanceMark,
  type CallupDecisionKind,
  type CallupResponseStatus,
  type TrainingDay,
  type TransportMode,
  MANAGEABLE_MATCH_TYPES,
  computeWeeklyTrainingAttendance,
  createSupabaseServerClient,
  getCurrentUser,
  isManageableMatchType,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { Role } from '../jugadores/queries';

export type ConvocatoriasScope =
  | { kind: 'all' }
  | {
      kind: 'restricted';
      /** Teams donde el user es staff activo (cualquier staff_role). */
      teamIds: string[];
      /**
       * Teams donde el user puede gestionar convocatorias: principal vía
       * `team_staff.staff_role` (autoridad por equipo, NO el rol del club),
       * o cualquier staff con capability `can_manage_callups`.
       */
      managedTeamIds: string[];
    }
  | { kind: 'player'; playerIds: string[] }
  | { kind: 'none' };

export type CallupMatchRow = {
  event_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  category_name: string;
  category_season: string;
  title: string;
  opponent_name: string | null;
  starts_at: string;
  /** True si la meta está publicada (apparece para player/family). */
  published: boolean;
  meeting_at: string | null;
  meeting_location: string | null;
  /** Conteo de respuestas (entrenador). */
  responses_count: { yes: number; maybe: number; no: number };
  /** Conteo de decisiones técnicas (entrenador). */
  decisions_count: { called_up: number; discarded: number };
  /** Roster del equipo a la fecha (para porcentajes). */
  roster_count: number;
  /** Mi respuesta (jugador/familia) — solo si scope='player'. */
  my_response: CallupResponseStatus | null;
};

export type CallupMetaRow = {
  event_id: string;
  meeting_at: string;
  meeting_location: string;
  meeting_address: string | null;
  transport_mode: TransportMode | null;
  transport_notes: string | null;
  notes_general: string | null;
  published_at: string | null;
  published_by: string | null;
};

export type CallupResponseRow = {
  player_id: string;
  status: CallupResponseStatus;
  reason: string | null;
  responded_by: string;
  responded_at: string;
};

export type CallupDecisionRow = {
  player_id: string;
  decision: CallupDecisionKind;
  reason: string | null;
  decided_by: string;
  decided_at: string;
  updated_at: string;
};

export type CallupPlayerRow = {
  id: string;
  first_name: string;
  last_name: string;
  dorsal: number | null;
};

export type CallupDetail = {
  event: {
    id: string;
    club_id: string;
    team_id: string;
    team_name: string;
    team_color: string;
    category_name: string;
    category_season: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
  };
  roster: CallupPlayerRow[];
  meta: CallupMetaRow | null;
  responses: Map<string, CallupResponseRow>;
  decisions: Map<string, CallupDecisionRow>;
  /** Player IDs que el user actual puede manejar (responder por). */
  ownedPlayerIds: string[];
  canManage: boolean;
  /**
   * ¿El user puede editar la ALINEACIÓN del partido? (helper SQL
   * user_can_manage_lineup: admin/coord, principal del team, o ayudante con
   * can_create_lineups). Distinto de canManage (can_manage_callups): el botón
   * "Editar alineación" usa este para que el cuerpo técnico —incluido el
   * ayudante con can_create_lineups— siempre lo vea.
   */
  canManageLineup: boolean;
  /**
   * ¿El user puede registrar el partido EN DIRECTO? (helper SQL F7.1
   * user_can_record_match: admin/coord, o cualquier team_staff activo del team
   * —principal o ayudante—). Gatea el botón "En directo" para que coincida con
   * quién puede entrar a la pantalla en vivo (gateada por el mismo helper).
   */
  canRecordMatch: boolean;
  /**
   * F8.2 — estado de la sesión de captura del partido (match_state.status).
   * 'not_started' si no hay fila. Habilita el paso "Post-partido" del stepper
   * cuando es 'closed' (partido finalizado → valoraciones abiertas).
   */
  matchStatus: 'not_started' | 'live' | 'closed';
  /**
   * Bug G — la convocatoria está publicada y hay decisiones del cuerpo técnico
   * modificadas DESPUÉS de la última publicación (cambios sin publicar).
   */
  hasUnpublishedChanges: boolean;
  /**
   * Mejora F7 — asistencia a los entrenos LUNES–VIERNES de la semana del partido.
   * `byPlayer[playerId]` = {attended,total}. `totalTrainings`=0 → no hubo entrenos
   * esa semana (la UI oculta el dato). Solo se computa para el cuerpo técnico.
   */
  weeklyTraining: {
    totalTrainings: number;
    byPlayer: Record<string, { attended: number; total: number }>;
  };
};

const COACH_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export async function resolveConvocatoriasScope(
  clubId: string,
  role: Role
): Promise<ConvocatoriasScope> {
  if (role === 'admin_club' || role === 'coordinador') return { kind: 'all' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  if (!user) return { kind: 'none' };

  if (role === 'entrenador_principal' || role === 'entrenador_ayudante') {
    type Row = {
      team_id: string;
      staff_role: string;
      memberships: { profile_id: string; club_id: string };
    };
    const { data } = await supabase
      .from('team_staff')
      .select('team_id, staff_role, memberships!inner(profile_id, club_id)')
      .is('left_at', null);
    const myRows = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter(
        (r) =>
          r.memberships.profile_id === user.id &&
          r.memberships.club_id === clubId
      );
    const teamIds = myRows.map((r) => r.team_id);

    // Detecta capability can_manage_callups en este club: si la tiene, todos
    // los teamIds del user pasan a managedTeamIds. Si no, solo los teams en
    // los que es principal vía team_staff.staff_role.
    type CapRow = {
      granted: boolean;
      memberships: { profile_id: string; club_id: string };
    };
    const { data: capData } = await supabase
      .from('capabilities')
      .select('granted, memberships!inner(profile_id, club_id)')
      .eq('capability_name', 'can_manage_callups');
    const hasCallupCap = (capData ?? [])
      .map((r) => r as unknown as CapRow)
      .some(
        (r) =>
          r.granted &&
          r.memberships.profile_id === user.id &&
          r.memberships.club_id === clubId
      );

    const managedTeamIds = hasCallupCap
      ? teamIds
      : myRows
          .filter((r) => r.staff_role === 'entrenador_principal')
          .map((r) => r.team_id);

    return { kind: 'restricted', teamIds, managedTeamIds };
  }

  if (role === 'jugador') {
    type Row = { player_id: string; players: { club_id: string } };
    const { data } = await supabase
      .from('player_accounts')
      .select('player_id, players!inner(club_id)')
      .eq('profile_id', user.id);
    const playerIds = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter((r) => r.players.club_id === clubId)
      .map((r) => r.player_id);
    return { kind: 'player', playerIds };
  }

  return { kind: 'none' };
}

/**
 * Lista de partidos próximos (siguientes 30 días) con resumen de convocatoria.
 */
export async function loadUpcomingCallups(
  clubId: string,
  role: Role,
  rangeDays: number = 30
): Promise<CallupMatchRow[]> {
  const scope = await resolveConvocatoriasScope(clubId, role);
  if (scope.kind === 'none') return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + rangeDays * 86_400_000
  ).toISOString();

  let q = supabase
    .from('events')
    .select(
      `id, club_id, team_id, title, opponent_name, starts_at,
       teams!inner(name, color, season, categories!inner(name))`
    )
    .eq('club_id', clubId)
    .in('type', MANAGEABLE_MATCH_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true })
    .limit(200);

  if (scope.kind === 'restricted') {
    if (scope.teamIds.length === 0) return [];
    q = q.in('team_id', scope.teamIds);
  } else if (scope.kind === 'player') {
    if (scope.playerIds.length === 0) return [];
    // jugador / familia: solo partidos de sus teams.
    type TM = { team_id: string };
    const { data: tms } = await supabase
      .from('team_members')
      .select('team_id')
      .in('player_id', scope.playerIds)
      .is('left_at', null);
    const teamIds = Array.from(
      new Set((tms ?? []).map((t) => (t as unknown as TM).team_id))
    );
    if (teamIds.length === 0) return [];
    q = q.in('team_id', teamIds);
  }

  const { data: rawEvents } = await q;

  type EventRow = {
    id: string;
    club_id: string;
    team_id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      season: string;
      categories: { name: string };
    };
  };
  const events = (rawEvents ?? []).map((e) => e as unknown as EventRow);
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);

  // Meta por evento (puede no existir si nadie publicó nada).
  const { data: metas } = await supabase
    .from('match_callup_meta')
    .select(
      'event_id, meeting_at, meeting_location, published_at'
    )
    .in('event_id', eventIds);
  type MetaRow = {
    event_id: string;
    meeting_at: string;
    meeting_location: string;
    published_at: string | null;
  };
  const metaByEvent = new Map<string, MetaRow>();
  for (const m of (metas ?? []) as MetaRow[]) {
    metaByEvent.set(m.event_id, m);
  }

  // Responses
  const { data: rawResponses } = await supabase
    .from('callup_responses')
    .select('event_id, player_id, status')
    .in('event_id', eventIds);
  type ResShape = {
    event_id: string;
    player_id: string;
    status: CallupResponseStatus;
  };
  const responsesByEvent = new Map<string, ResShape[]>();
  for (const r of (rawResponses ?? []) as ResShape[]) {
    const list = responsesByEvent.get(r.event_id) ?? [];
    list.push(r);
    responsesByEvent.set(r.event_id, list);
  }

  // Decisions
  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select('event_id, decision')
    .in('event_id', eventIds);
  type DecShape = { event_id: string; decision: CallupDecisionKind };
  const decisionsByEvent = new Map<
    string,
    { called_up: number; discarded: number }
  >();
  for (const d of (rawDecisions ?? []) as DecShape[]) {
    const cur = decisionsByEvent.get(d.event_id) ?? {
      called_up: 0,
      discarded: 0,
    };
    if (d.decision === 'called_up') cur.called_up++;
    else cur.discarded++;
    decisionsByEvent.set(d.event_id, cur);
  }

  // Roster snapshot por team.
  const teamIds = Array.from(new Set(events.map((e) => e.team_id)));
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('team_id, player_id, joined_at, left_at')
    .in('team_id', teamIds);
  type RosterRow = {
    team_id: string;
    player_id: string;
    joined_at: string;
    left_at: string | null;
  };
  const roster = (rosterRows ?? []).map((r) => r as unknown as RosterRow);

  return events.map((e) => {
    const eventDate = e.starts_at.slice(0, 10);
    const rosterCount = roster.filter(
      (r) =>
        r.team_id === e.team_id &&
        r.joined_at <= eventDate &&
        (r.left_at == null || r.left_at >= eventDate)
    ).length;

    const responses = responsesByEvent.get(e.id) ?? [];
    const respCount = { yes: 0, maybe: 0, no: 0 };
    let myResponse: CallupResponseStatus | null = null;
    for (const r of responses) {
      respCount[r.status]++;
      if (
        scope.kind === 'player' &&
        scope.playerIds.includes(r.player_id)
      ) {
        myResponse = r.status;
      }
    }
    const decisions = decisionsByEvent.get(e.id) ?? {
      called_up: 0,
      discarded: 0,
    };
    const meta = metaByEvent.get(e.id) ?? null;

    return {
      event_id: e.id,
      team_id: e.team_id,
      team_name: e.teams.name,
      team_color: e.teams.color,
      category_name: e.teams.categories.name,
      category_season: e.teams.season,
      title: e.title,
      opponent_name: e.opponent_name,
      starts_at: e.starts_at,
      published: meta?.published_at != null,
      meeting_at: meta?.meeting_at ?? null,
      meeting_location: meta?.meeting_location ?? null,
      responses_count: respCount,
      decisions_count: decisions,
      roster_count: rosterCount,
      my_response: myResponse,
    };
  });
}

/**
 * Detalle de una convocatoria. Carga roster + meta + respuestas + decisiones.
 * Si el scope es 'player', devuelve solo lo visible para ellos.
 */
export async function loadCallupDetail(
  clubId: string,
  role: Role,
  eventId: string
): Promise<CallupDetail | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, opponent_name, starts_at,
       location_name, location_address,
       teams!inner(name, color, season, categories!inner(name))`
    )
    .eq('id', eventId)
    .maybeSingle();

  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (!isManageableMatchType(ev.type as string)) return null;
  if (ev.team_id == null) return null;

  type EventShape = {
    id: string;
    club_id: string;
    team_id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
    teams: {
      name: string;
      color: string;
      season: string;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EventShape;

  const scope = await resolveConvocatoriasScope(clubId, role);
  if (scope.kind === 'none') return null;
  if (
    scope.kind === 'restricted' &&
    !scope.teamIds.includes(event.team_id)
  )
    return null;

  // Roster a la fecha del partido.
  const eventDate = event.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal)'
    )
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type RosterShape = {
    player_id: string;
    joined_at: string;
    left_at: string | null;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      dorsal: number | null;
    };
  };
  const allRoster = (rosterRows ?? []).map((r) => r as unknown as RosterShape);
  const activeRoster = allRoster.filter(
    (r) => r.left_at == null || r.left_at >= eventDate
  );

  // Filtrar a propios si jugador.
  const visibleRoster =
    scope.kind === 'player'
      ? activeRoster.filter((r) => scope.playerIds.includes(r.player_id))
      : activeRoster;

  const ownedPlayerIds =
    scope.kind === 'player'
      ? scope.playerIds.filter((pid) =>
          activeRoster.some((r) => r.player_id === pid)
        )
      : [];

  // Meta
  const { data: metaRow } = await supabase
    .from('match_callup_meta')
    .select(
      'event_id, meeting_at, meeting_location, meeting_address, transport_mode, transport_notes, notes_general, published_at, published_by'
    )
    .eq('event_id', eventId)
    .maybeSingle();
  const meta = (metaRow as unknown as CallupMetaRow | null) ?? null;

  // Responses
  const { data: rawResponses } = await supabase
    .from('callup_responses')
    .select(
      'player_id, status, reason, responded_by, responded_at'
    )
    .eq('event_id', eventId);
  const responses = new Map<string, CallupResponseRow>();
  for (const r of (rawResponses ?? []) as CallupResponseRow[]) {
    responses.set(r.player_id, r);
  }

  // Decisions
  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select(
      'player_id, decision, reason, decided_by, decided_at, updated_at'
    )
    .eq('event_id', eventId);
  const decisions = new Map<string, CallupDecisionRow>();
  for (const d of (rawDecisions ?? []) as CallupDecisionRow[]) {
    decisions.set(d.player_id, d);
  }

  // Bug G — ¿hay decisiones cambiadas después de la última publicación?
  const publishedTs = meta?.published_at
    ? Date.parse(meta.published_at)
    : null;
  const hasUnpublishedChanges =
    publishedTs != null &&
    Array.from(decisions.values()).some(
      (d) => Date.parse(d.updated_at) > publishedTs,
    );

  // canManage refleja la lógica del helper SQL `user_can_manage_callup`
  // (migración 20260603): admin/coord del club, principal vía team_staff.
  // staff_role (no memberships.role), o staff del team con can_manage_callups.
  const canManage =
    scope.kind === 'all' ||
    (scope.kind === 'restricted' &&
      scope.managedTeamIds.includes(event.team_id));

  // Autoridad sobre la ALINEACIÓN (helper SQL, mismo que la RLS de F6). Permite
  // que el ayudante con can_create_lineups vea "Editar alineación" aunque no
  // tenga can_manage_callups.
  const { data: canManageLineupRaw } = await supabase.rpc(
    'user_can_manage_lineup',
    { p_event_id: eventId },
  );
  const canManageLineup = canManageLineupRaw === true;

  // Autoridad de captura en vivo (helper SQL F7.1, mismo que la RLS y que la
  // pantalla /directo): cualquier team_staff del partido + admin/coord.
  const { data: canRecordMatchRaw } = await supabase.rpc(
    'user_can_record_match',
    { p_event_id: eventId },
  );
  const canRecordMatch = canRecordMatchRaw === true;

  // F8.2 — estado del partido para habilitar el paso "Post-partido" del stepper.
  let matchStatus: CallupDetail['matchStatus'] = 'not_started';
  if (canRecordMatch) {
    const { data: stateRow } = await supabase
      .from('match_state')
      .select('status')
      .eq('event_id', eventId)
      .maybeSingle();
    matchStatus =
      (stateRow?.status as CallupDetail['matchStatus'] | undefined) ??
      'not_started';
  }

  // Mejora F7 — asistencia a entrenos L–V de la semana del partido. Solo para el
  // cuerpo técnico (el jugador/familia no ve la asistencia de los demás; además
  // su RLS no leería training_attendance ajena). Se traen los entrenos del equipo
  // en una ventana amplia alrededor del partido y el motor puro filtra a L–V de la
  // semana y cuenta. Fechas civiles en zona Europe/Madrid.
  const toMadridDate = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(
      new Date(iso),
    );
  const weeklyTraining: CallupDetail['weeklyTraining'] = {
    totalTrainings: 0,
    byPlayer: {},
  };
  if (scope.kind !== 'player') {
    const matchDate = toMadridDate(event.starts_at);
    const lo = new Date(event.starts_at);
    lo.setDate(lo.getDate() - 8);
    const hi = new Date(event.starts_at);
    hi.setDate(hi.getDate() + 7);
    const { data: trainRows } = await supabase
      .from('events')
      .select('id, starts_at')
      .eq('team_id', event.team_id)
      .eq('type', 'training')
      .gte('starts_at', lo.toISOString())
      .lte('starts_at', hi.toISOString());
    const trainings: TrainingDay[] = (trainRows ?? []).map((r) => ({
      id: r.id as string,
      date: toMadridDate(r.starts_at as string),
    }));
    if (trainings.length > 0) {
      const trainingIds = trainings.map((t) => t.id);
      const { data: attRows } = await supabase
        .from('training_attendance')
        .select('player_id, event_id, code')
        .in('event_id', trainingIds);
      const attendance: AttendanceMark[] = (attRows ?? []).map((r) => ({
        playerId: r.player_id as string,
        eventId: r.event_id as string,
        code: r.code as AttendanceCode,
      }));
      const computed = computeWeeklyTrainingAttendance({
        matchDate,
        trainings,
        attendance,
        rosterIds: visibleRoster.map((r) => r.players.id),
      });
      weeklyTraining.totalTrainings = computed.totalTrainings;
      for (const [pid, v] of computed.byPlayer) weeklyTraining.byPlayer[pid] = v;
    }
  }

  return {
    event: {
      id: event.id,
      club_id: event.club_id,
      team_id: event.team_id,
      team_name: event.teams.name,
      team_color: event.teams.color,
      category_name: event.teams.categories.name,
      category_season: event.teams.season,
      title: event.title,
      opponent_name: event.opponent_name,
      starts_at: event.starts_at,
      location_name: event.location_name,
      location_address: event.location_address,
    },
    roster: visibleRoster
      .map((r) => ({
        id: r.players.id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        dorsal: r.players.dorsal,
      }))
      .sort((a, b) =>
        (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
          sensitivity: 'base',
        })
      ),
    meta,
    responses,
    decisions,
    ownedPlayerIds,
    canManage,
    canManageLineup,
    canRecordMatch,
    matchStatus,
    hasUnpublishedChanges,
    weeklyTraining,
  };
}

export { COACH_ROLES };
