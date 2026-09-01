/**
 * O2-7b-1 — Lectura de CONVOCATORIAS lado STAFF (lista + detalle), framework-
 * agnóstica. Extraído de `apps/web/.../convocatorias/queries.ts` (`loadUpcomingCallups`
 * + `loadCallupDetail`). La web pasa a delegar (mismas queries, mismo mapeo/orden →
 * comportamiento idéntico); la app nativa lo consume con el rol del club activo y el
 * `userId` de la sesión.
 *
 * SOLO LECTURA. La ESCRITURA (decidir) vive en `staff-writes.ts`. El lado FAMILIA
 * (`getPlayerCallupsFromClient`, E1) NO se toca: la rama de jugador de la lista sigue
 * delegando en él. `canManage` refleja el gate RLS `user_can_manage_callup`; el
 * candado real es la RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import type {
  CallupDecisionKind,
  CallupResponseStatus,
  TransportMode,
} from '../schemas/callup';
import type { TeamFormat } from '../lineups/types';
import type { AttendanceMark, TrainingDay } from '../attendance/index';
import { computeWeeklyTrainingAttendance } from '../attendance/index';
import type { AttendanceCode } from '../schemas/attendance';
import { groupRosterByCallup } from '../lineups/callup-sync';
import { MANAGEABLE_MATCH_TYPES, isManageableMatchType } from '../events/types';
import { getPlayerCallupsFromClient } from './queries';
import {
  getPlayersWithoutAppFromClient,
  type PlayersWithoutApp,
} from '../players/no-app-lookup';
import {
  resolveConvocatoriasScopeFromClient,
  type ConvocatoriasScope,
} from './staff-scope';

type DbClient = SupabaseClient<Database>;

export type CallupMatchRow = {
  event_id: string;
  team_id: string;
  type: string;
  tournament_id: string | null;
  round: number | null;
  team_name: string;
  team_color: string;
  category_name: string;
  category_season: string;
  title: string;
  opponent_name: string | null;
  starts_at: string;
  published: boolean;
  meeting_at: string | null;
  meeting_location: string | null;
  responses_count: { yes: number; maybe: number; no: number };
  decisions_count: { called_up: number; discarded: number };
  roster_count: number;
  my_response: CallupResponseStatus | null;
  can_record_match: boolean;
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
  is_promoted?: boolean;
  from_team_name?: string | null;
  /**
   * Slice C — `true` = la familia del jugador NO ha entrado en la app, así que NO
   * recibe la convocatoria ni el aviso al publicar (marcador "Sin app"). Se marca
   * justo aquí porque es donde se decide a quién se avisa. SOLO PRESENTACIÓN — no
   * gatea nada: se le convoca igual.
   *
   * `undefined` = no se ha consultado (rama FAMILIA del loader) o no se ha podido
   * (RLS/error) → no se pinta marcador.
   */
  no_app?: boolean;
};

export type CallupDetail = {
  event: {
    id: string;
    club_id: string;
    team_id: string;
    type: string;
    team_name: string;
    team_color: string;
    category_name: string;
    category_season: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
    tournament_id: string | null;
    /** O2-7b-1 — modalidad del equipo, para el aviso de TOPE de convocados. */
    format: TeamFormat;
  };
  roster: CallupPlayerRow[];
  meta: CallupMetaRow | null;
  responses: Map<string, CallupResponseRow>;
  decisions: Map<string, CallupDecisionRow>;
  ownedPlayerIds: string[];
  canManage: boolean;
  canManageLineup: boolean;
  canRecordMatch: boolean;
  matchStatus: 'not_started' | 'live' | 'closed';
  hasUnpublishedChanges: boolean;
  weeklyTraining: {
    totalTrainings: number;
    byPlayer: Record<string, { attended: number; total: number }>;
  };
};

/**
 * Lista de partidos próximos con resumen de convocatoria. La rama de jugador/familia
 * delega en `getPlayerCallupsFromClient` (E1, intacto); el resto es lógica staff.
 * Réplica de `loadUpcomingCallups`.
 */
export async function getStaffCallupsFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    rangeDays?: number;
    nowMs?: number;
    /** S2 modo Míster: acota a los equipos del usuario (ver resolveConvocatoriasScope). */
    asStaffMember?: boolean;
  },
): Promise<CallupMatchRow[]> {
  const { clubId, role, userId, asStaffMember } = params;
  const rangeDays = params.rangeDays ?? 30;
  const nowMs = params.nowMs ?? Date.now();

  const scope = await resolveConvocatoriasScopeFromClient(supabase, {
    clubId,
    role,
    userId,
    asStaffMember,
  });
  if (scope.kind === 'none') return [];

  const nowIso = new Date(nowMs).toISOString();
  const untilIso = new Date(nowMs + rangeDays * 86_400_000).toISOString();

  // Rama jugador/familia (E1) — sin tocar.
  if (scope.kind === 'player') {
    return getPlayerCallupsFromClient(supabase, clubId, scope.playerIds, {
      fromIso: nowIso,
      toIso: untilIso,
    });
  }

  let q = supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, tournament_id, round, title, opponent_name, starts_at,
       teams!inner(name, color, season, categories!inner(name))`,
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
  }

  const { data: rawEvents } = await q;

  type EventRow = {
    id: string;
    club_id: string;
    team_id: string;
    type: string;
    tournament_id: string | null;
    round: number | null;
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

  // F13B (T-5) — traer cabeceras de torneo referenciadas pero fuera de ventana.
  const presentIds = new Set(events.map((e) => e.id));
  const missingHeaderIds = Array.from(
    new Set(
      events
        .map((e) => e.tournament_id)
        .filter((id): id is string => id != null && !presentIds.has(id)),
    ),
  );
  if (missingHeaderIds.length > 0) {
    const { data: headerRows } = await supabase
      .from('events')
      .select(
        `id, club_id, team_id, type, tournament_id, round, title, opponent_name, starts_at,
         teams!inner(name, color, season, categories!inner(name))`,
      )
      .eq('club_id', clubId)
      .in('id', missingHeaderIds);
    for (const h of (headerRows ?? []).map((e) => e as unknown as EventRow)) {
      if (!presentIds.has(h.id)) {
        events.push(h);
        presentIds.add(h.id);
      }
    }
  }

  const eventIds = events.map((e) => e.id);

  const { data: metas } = await supabase
    .from('match_callup_meta')
    .select('event_id, meeting_at, meeting_location, published_at')
    .in('event_id', eventIds);
  type MetaRow = {
    event_id: string;
    meeting_at: string;
    meeting_location: string;
    published_at: string | null;
  };
  const metaByEvent = new Map<string, MetaRow>();
  for (const m of (metas ?? []) as MetaRow[]) metaByEvent.set(m.event_id, m);

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

  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select('event_id, player_id, decision')
    .in('event_id', eventIds);
  type DecShape = {
    event_id: string;
    player_id: string;
    decision: CallupDecisionKind;
  };
  const discardedByEvent = new Map<string, Set<string>>();
  for (const d of (rawDecisions ?? []) as DecShape[]) {
    if (d.decision !== 'discarded') continue;
    const cur = discardedByEvent.get(d.event_id) ?? new Set<string>();
    cur.add(d.player_id);
    discardedByEvent.set(d.event_id, cur);
  }

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

  const canRecordFor = (teamId: string): boolean =>
    scope.kind === 'all' ||
    (scope.kind === 'restricted' && scope.teamIds.includes(teamId));

  return events.map((e) => {
    const eventDate = e.starts_at.slice(0, 10);
    const rosterIds = roster
      .filter(
        (r) =>
          r.team_id === e.team_id &&
          r.joined_at <= eventDate &&
          (r.left_at == null || r.left_at >= eventDate),
      )
      .map((r) => r.player_id);
    const rosterCount = rosterIds.length;

    const responses = responsesByEvent.get(e.id) ?? [];
    const respCount = { yes: 0, maybe: 0, no: 0 };
    const myResponse: CallupResponseStatus | null = null;
    for (const r of responses) respCount[r.status]++;

    const discardedSet = discardedByEvent.get(e.id) ?? new Set<string>();
    const groups = groupRosterByCallup(rosterIds, (pid) =>
      discardedSet.has(pid) ? 'discarded' : null,
    );
    const decisions = {
      called_up: groups.calledUp.length,
      discarded: groups.discarded.length,
    };
    const meta = metaByEvent.get(e.id) ?? null;

    return {
      event_id: e.id,
      team_id: e.team_id,
      type: e.type,
      tournament_id: e.tournament_id,
      round: e.round,
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
      can_record_match: canRecordFor(e.team_id),
    };
  });
}

/**
 * Detalle de una convocatoria: roster (histórico + subidos) + meta + respuestas de
 * familias + decisiones + canManage/canManageLineup/canRecordMatch + estado del
 * partido + asistencia semanal + `format` (para el tope). Réplica de `loadCallupDetail`.
 *
 * Slice C — añade `no_app` por jugador (marcador "Sin app") SOLO en las ramas de
 * staff/dirección: una consulta más (`getPlayersWithoutAppFromClient`), con la MISMA
 * guarda `scope.kind !== 'player'` que ya usa la asistencia semanal, así que la rama
 * de FAMILIA hace exactamente las mismas queries que antes.
 * Devuelve null si el evento no existe / no es partido gestionable / fuera de scope.
 */
export async function getStaffCallupDetailFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    eventId: string;
    nowMs?: number;
    /** S2 modo Míster: acota a los equipos del usuario (ver resolveConvocatoriasScope). */
    asStaffMember?: boolean;
  },
): Promise<CallupDetail | null> {
  const { clubId, role, userId, eventId, asStaffMember } = params;

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, tournament_id, title, opponent_name, starts_at,
       location_name, location_address,
       teams!inner(name, color, season, format, categories!inner(name))`,
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
    type: string;
    tournament_id: string | null;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
    teams: {
      name: string;
      color: string;
      season: string;
      format: TeamFormat;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EventShape;

  const scope: ConvocatoriasScope = await resolveConvocatoriasScopeFromClient(
    supabase,
    { clubId, role, userId, asStaffMember },
  );
  if (scope.kind === 'none') return null;
  if (scope.kind === 'restricted' && !scope.teamIds.includes(event.team_id))
    return null;

  const eventDate = event.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal)',
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
    (r) => r.left_at == null || r.left_at >= eventDate,
  );

  const { data: promoRows } = await supabase
    .from('player_promotions')
    .select(
      'player_id, players!inner(id, first_name, last_name, dorsal, team_members(left_at, teams(name)))',
    )
    .eq('event_id', event.id);
  type PromoShape = {
    player_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      dorsal: number | null;
      team_members: { left_at: string | null; teams: { name: string } | null }[];
    };
  };
  const promotedInfo = new Map<string, string | null>();
  const promotedRoster: RosterShape[] = (promoRows ?? [])
    .map((r) => r as unknown as PromoShape)
    .filter((r) => !activeRoster.some((ar) => ar.player_id === r.player_id))
    .map((r) => {
      const base = (r.players.team_members ?? []).find(
        (tm) => tm.left_at == null,
      );
      promotedInfo.set(r.player_id, base?.teams?.name ?? null);
      return {
        player_id: r.player_id,
        joined_at: eventDate,
        left_at: null,
        players: {
          id: r.players.id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          dorsal: r.players.dorsal,
        },
      };
    });
  const fullRoster = [...activeRoster, ...promotedRoster];

  const visibleRoster =
    scope.kind === 'player'
      ? fullRoster.filter((r) => scope.playerIds.includes(r.player_id))
      : fullRoster;

  const ownedPlayerIds =
    scope.kind === 'player'
      ? scope.playerIds.filter((pid) =>
          fullRoster.some((r) => r.player_id === pid),
        )
      : [];

  const { data: metaRow } = await supabase
    .from('match_callup_meta')
    .select(
      'event_id, meeting_at, meeting_location, meeting_address, transport_mode, transport_notes, notes_general, published_at, published_by',
    )
    .eq('event_id', eventId)
    .maybeSingle();
  const meta = (metaRow as unknown as CallupMetaRow | null) ?? null;

  const { data: rawResponses } = await supabase
    .from('callup_responses')
    .select('player_id, status, reason, responded_by, responded_at')
    .eq('event_id', eventId);
  const responses = new Map<string, CallupResponseRow>();
  for (const r of (rawResponses ?? []) as CallupResponseRow[]) {
    responses.set(r.player_id, r);
  }

  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select('player_id, decision, reason, decided_by, decided_at, updated_at')
    .eq('event_id', eventId);
  const decisions = new Map<string, CallupDecisionRow>();
  for (const d of (rawDecisions ?? []) as CallupDecisionRow[]) {
    decisions.set(d.player_id, d);
  }

  const publishedTs = meta?.published_at ? Date.parse(meta.published_at) : null;
  const hasUnpublishedChanges =
    publishedTs != null &&
    Array.from(decisions.values()).some(
      (d) => Date.parse(d.updated_at) > publishedTs,
    );

  const canManage =
    scope.kind === 'all' ||
    (scope.kind === 'restricted' &&
      scope.managedTeamIds.includes(event.team_id));

  const { data: canManageLineupRaw } = await supabase.rpc(
    'user_can_manage_lineup',
    { p_event_id: eventId },
  );
  const canManageLineup = canManageLineupRaw === true;

  const { data: canRecordMatchRaw } = await supabase.rpc(
    'user_can_record_match',
    { p_event_id: eventId },
  );
  const canRecordMatch = canRecordMatchRaw === true;

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

  // Asistencia L–V de la semana del partido (solo staff). Fechas civiles Europe/Madrid.
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
      .is('cancelled_at', null)
      .or('approval_status.is.null,approval_status.eq.approved')
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

  // Slice C — marcador "Sin app". SOLO en las ramas de staff/dirección: en la rama
  // FAMILIA (`scope.kind === 'player'`) el tutor solo ve a sus hijos, que por
  // definición están vinculados, y su RLS no le dejaría leer el resto → ni se
  // consulta (misma guarda que la asistencia semanal de arriba).
  const queriedNoApp = scope.kind !== 'player';
  let withoutApp: PlayersWithoutApp = [];
  if (queriedNoApp) {
    withoutApp = await getPlayersWithoutAppFromClient(
      supabase,
      visibleRoster.map((r) => r.players.id),
    );
  }
  const withoutAppSet = new Set(withoutApp);

  return {
    event: {
      id: event.id,
      club_id: event.club_id,
      team_id: event.team_id,
      type: event.type,
      team_name: event.teams.name,
      team_color: event.teams.color,
      category_name: event.teams.categories.name,
      category_season: event.teams.season,
      title: event.title,
      opponent_name: event.opponent_name,
      starts_at: event.starts_at,
      location_name: event.location_name,
      location_address: event.location_address,
      tournament_id: event.tournament_id,
      format: event.teams.format,
    },
    roster: visibleRoster
      .map((r) => ({
        id: r.players.id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        dorsal: r.players.dorsal,
        is_promoted: promotedInfo.has(r.players.id),
        from_team_name: promotedInfo.get(r.players.id) ?? null,
        no_app: queriedNoApp ? withoutAppSet.has(r.players.id) : undefined,
      }))
      .sort((a, b) =>
        (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
          sensitivity: 'base',
        }),
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
