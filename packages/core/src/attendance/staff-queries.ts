/**
 * O2-7a — Lectura de ASISTENCIA para el STAFF (listado de sesiones + detalle de
 * marcado), framework-agnóstica. Extraído de `apps/web/.../asistencia/queries.ts`
 * (`loadRecentTrainings` + `loadEventAttendance`). La web pasa a delegar (mismas
 * queries, mismo mapeo y ordenación → comportamiento idéntico); la app nativa lo
 * consume con el rol del club activo y el `userId` de la sesión.
 *
 * SOLO LECTURA. La ESCRITURA (pasar lista) vive en `staff-writes.ts`. El gate de
 * quién puede escribir es server-side (`user_can_record_attendance`): aquí solo se
 * expone `canRecord` (misma verdad que la RLS, vía RPC) para condicionar la UI.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import type { AttendanceCode } from '../schemas/attendance';
import {
  resolveAttendanceScopeFromClient,
  type AttendanceScope,
} from './scope';

type DbClient = SupabaseClient<Database>;

export type StaffTrainingEvent = {
  id: string;
  club_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  category_name: string;
  category_season: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  /** Cuántos marcados / cuántos jugadores en roster. */
  marked_count: number;
  roster_count: number;
};

export type AttendanceRecord = {
  id: string;
  event_id: string;
  player_id: string;
  code: AttendanceCode;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
  updated_at: string;
};

export type AttendanceRosterPlayer = {
  id: string;
  first_name: string;
  last_name: string;
  dorsal: number | null;
  /** D2.1 — true si el jugador está SUBIDO a este entreno (no es del roster). */
  is_promoted?: boolean;
  /** D2.1 — nombre del equipo base del jugador subido (para el badge). */
  from_team_name?: string | null;
};

export type EventAttendanceData = {
  event: {
    id: string;
    club_id: string;
    team_id: string;
    team_name: string;
    team_color: string;
    category_name: string;
    category_season: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
  };
  roster: AttendanceRosterPlayer[];
  /** Estado ya registrado, por player_id. En la app se serializa como pares. */
  attendance: Map<string, AttendanceRecord>;
  canRecord: boolean;
  /** Pre-computado (no `Date.now()` en render — regla react-hooks/purity). */
  isFuture: boolean;
};

/**
 * Entrenamientos recientes (últimos `rangeDays` días, no futuros) del scope del
 * usuario, con conteo marcados/roster. Réplica de `loadRecentTrainings`.
 */
export async function getRecentTrainingsFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    rangeDays?: number;
    teamId?: string;
    nowMs?: number;
    /** S2 modo Míster: acota a los equipos del usuario (ver resolveAttendanceScope). */
    asStaffMember?: boolean;
  },
): Promise<StaffTrainingEvent[]> {
  const { clubId, role, userId, teamId, asStaffMember } = params;
  const rangeDays = params.rangeDays ?? 30;
  const nowMs = params.nowMs ?? Date.now();

  const scope = await resolveAttendanceScopeFromClient(supabase, {
    clubId,
    role,
    userId,
    asStaffMember,
  });
  if (scope.kind === 'none') return [];

  const sinceIso = new Date(nowMs - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  let q = supabase
    .from('events')
    .select(
      `id, club_id, team_id, title, starts_at, ends_at,
       teams!inner(name, color, season, categories!inner(name))`,
    )
    .eq('club_id', clubId)
    .eq('type', 'training')
    // F14F-1b — un entrenamiento cancelado no ocurrió: fuera del listado.
    .is('cancelled_at', null)
    // F14F-4 — un training pendiente/rechazado no cuenta: solo normales/aprobados.
    .or('approval_status.is.null,approval_status.eq.approved')
    .gte('starts_at', sinceIso)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending: false })
    .limit(200);

  if (scope.kind === 'restricted') {
    if (scope.teamIds.length === 0) return [];
    q = q.in('team_id', scope.teamIds);
  }
  if (scope.kind === 'player') {
    if (scope.playerIds.length === 0) return [];
    type TM = { team_id: string };
    const { data: tms } = await supabase
      .from('team_members')
      .select('team_id')
      .in('player_id', scope.playerIds)
      .is('left_at', null);
    const teamIds = Array.from(
      new Set((tms ?? []).map((t) => (t as unknown as TM).team_id)),
    );
    if (teamIds.length === 0) return [];
    q = q.in('team_id', teamIds);
  }

  // Filtro opcional por equipo (intersecta con el scope).
  if (teamId) q = q.eq('team_id', teamId);

  const { data: rawEvents } = await q;

  type EventRow = {
    id: string;
    club_id: string;
    team_id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
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

  const { data: markedRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const markedCount = new Map<string, number>();
  for (const r of markedRows ?? []) {
    const id = r.event_id as string;
    markedCount.set(id, (markedCount.get(id) ?? 0) + 1);
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

  return events.map((e) => {
    const eventDate = e.starts_at.slice(0, 10);
    const rosterCount = roster.filter(
      (r) =>
        r.team_id === e.team_id &&
        r.joined_at <= eventDate &&
        (r.left_at == null || r.left_at >= eventDate),
    ).length;
    return {
      id: e.id,
      club_id: e.club_id,
      team_id: e.team_id,
      team_name: e.teams.name,
      team_color: e.teams.color,
      category_name: e.teams.categories.name,
      category_season: e.teams.season,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      marked_count: markedCount.get(e.id) ?? 0,
      roster_count: rosterCount,
    };
  });
}

/**
 * Detalle de un evento para la pantalla de marcado: meta + roster histórico al día
 * del evento (+ jugadores subidos) + asistencia ya registrada + `canRecord` (RPC,
 * misma verdad que la RLS). Réplica de `loadEventAttendance`. Devuelve null si el
 * evento no existe / no es training visible / está fuera del scope.
 */
export async function getEventAttendanceFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    eventId: string;
    nowMs?: number;
    /** S2 modo Míster: acota a los equipos del usuario (ver resolveAttendanceScope). */
    asStaffMember?: boolean;
  },
): Promise<EventAttendanceData | null> {
  const { clubId, role, userId, eventId, asStaffMember } = params;
  const nowMs = params.nowMs ?? Date.now();

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, starts_at, ends_at, cancelled_at, approval_status,
       teams!inner(name, color, season, categories!inner(name))`,
    )
    .eq('id', eventId)
    .maybeSingle();

  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (ev.type !== 'training') return null;
  // F14F-1b / F14F-4 — cancelado o pendiente/rechazado no pide pasar lista.
  if (ev.cancelled_at != null) return null;
  if (ev.approval_status === 'pending' || ev.approval_status === 'rejected')
    return null;
  if (ev.team_id == null) return null;

  type EventShape = {
    id: string;
    club_id: string;
    team_id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    teams: {
      name: string;
      color: string;
      season: string;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EventShape;

  const scope: AttendanceScope = await resolveAttendanceScopeFromClient(
    supabase,
    { clubId, role, userId, asStaffMember },
  );
  if (scope.kind === 'none') return null;
  if (scope.kind === 'restricted' && !scope.teamIds.includes(event.team_id))
    return null;

  // Roster histórico al día del evento.
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

  // D2.1 — jugadores SUBIDOS a este entreno (player_promotions).
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

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select(
      'id, event_id, player_id, code, notes, recorded_by, recorded_at, updated_at',
    )
    .eq('event_id', eventId);

  const attendance = new Map<string, AttendanceRecord>();
  for (const r of (attRows ?? []) as AttendanceRecord[]) {
    attendance.set(r.player_id, r);
  }

  // canRecord: MISMA verdad que la RLS (RPC SECURITY DEFINER).
  const { data: canRec } = await supabase.rpc('user_can_record_attendance', {
    p_event_id: event.id,
  });
  const canRecord = canRec === true;

  const isFuture = new Date(event.starts_at).getTime() > nowMs;

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
      starts_at: event.starts_at,
      ends_at: event.ends_at,
    },
    roster: visibleRoster
      .map((r) => ({
        id: r.players.id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        dorsal: r.players.dorsal,
        is_promoted: promotedInfo.has(r.players.id),
        from_team_name: promotedInfo.get(r.players.id) ?? null,
      }))
      .sort((a, b) =>
        (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
          sensitivity: 'base',
        }),
      ),
    attendance,
    canRecord,
    isFuture,
  };
}
