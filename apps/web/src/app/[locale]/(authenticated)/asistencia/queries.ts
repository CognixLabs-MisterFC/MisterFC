/**
 * F4 Lote A — Queries de asistencia a entrenamientos.
 *
 * Reusa `events` (F3) + `team_members` (F2.5) + `training_attendance` (F4.1).
 * Sin modelo nuevo más allá del propio Lote A.
 *
 * Permisos de lectura:
 *  - admin / coord / principal / ayudante → ven asistencia de su team_id
 *    (hereda RLS de events_select_member, bug F3-rls-events-visibilidad
 *    sigue activo en BD: la UI filtra por scope).
 *  - jugador → ver solo su propia fila (filtramos por player_id vinculado).
 *
 * Permisos de escritura: ver `actions.ts`.
 */

import {
  type AttendanceCode,
  createSupabaseServerClient,
  getCurrentUser,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { Role } from '../jugadores/queries';

export type TrainingEvent = {
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

export type AttendanceRow = {
  id: string;
  event_id: string;
  player_id: string;
  code: AttendanceCode;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
  updated_at: string;
};

export type RosterPlayer = {
  id: string;
  first_name: string;
  last_name: string;
  dorsal: number | null;
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
  roster: RosterPlayer[];
  attendance: Map<string, AttendanceRow>;
  canRecord: boolean;
  /** Pre-computado server-side para evitar Date.now() en render
   *  (regla react-hooks/purity de React Compiler). */
  isFuture: boolean;
};

export type AsistenciaScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[] }
  | { kind: 'player'; playerIds: string[] }
  | { kind: 'none' };

const WRITE_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * Determina el scope de visibilidad del user para asistencia.
 *  - admin / coord → all
 *  - principal / ayudante → restricted a sus teams activos
 *  - jugador → solo sus jugadores vinculados (via player_accounts)
 */
export async function resolveAsistenciaScope(
  clubId: string,
  role: Role
): Promise<AsistenciaScope> {
  if (role === 'admin_club' || role === 'coordinador') return { kind: 'all' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  if (!user) return { kind: 'none' };

  if (role === 'entrenador_principal' || role === 'entrenador_ayudante') {
    type Row = {
      team_id: string;
      memberships: { profile_id: string; club_id: string };
    };
    const { data } = await supabase
      .from('team_staff')
      .select('team_id, memberships!inner(profile_id, club_id)')
      .is('left_at', null);
    const teamIds = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter(
        (r) =>
          r.memberships.profile_id === user.id &&
          r.memberships.club_id === clubId
      )
      .map((r) => r.team_id);
    return { kind: 'restricted', teamIds };
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
 * Carga los entrenamientos recientes/pendientes (últimos 30 días),
 * con conteo de jugadores marcados vs roster esperado.
 */
export async function loadRecentTrainings(
  clubId: string,
  role: Role,
  rangeDays: number = 30,
  teamId?: string
): Promise<TrainingEvent[]> {
  const scope = await resolveAsistenciaScope(clubId, role);
  if (scope.kind === 'none') return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const sinceIso = new Date(
    Date.now() - rangeDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const nowIso = new Date().toISOString();

  let q = supabase
    .from('events')
    .select(
      `id, club_id, team_id, title, starts_at, ends_at,
       teams!inner(name, color, categories!inner(name, season))`
    )
    .eq('club_id', clubId)
    .eq('type', 'training')
    .gte('starts_at', sinceIso)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending: false })
    .limit(200);

  if (scope.kind === 'restricted') {
    if (scope.teamIds.length === 0) return [];
    q = q.in('team_id', scope.teamIds);
  }
  // 'player' scope: el jugador no necesita ver el listado completo; la UI
  // tampoco lo expone (la sidebar oculta /asistencia para jugadores).
  if (scope.kind === 'player') {
    if (scope.playerIds.length === 0) return [];
    // Filtra a equipos donde el jugador tiene team_members activo.
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

  // #7 — filtro opcional por equipo (admin/coord lo eligen en la UI). Intersecta
  // con el scope (un coach con `.in(teamIds)` + `.eq(teamId)` sigue acotado).
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
      categories: { name: string; season: string };
    };
  };

  const events = (rawEvents ?? []).map((e) => e as unknown as EventRow);
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);

  // Conteo de marcados por evento.
  const { data: markedRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const markedCount = new Map<string, number>();
  for (const r of markedRows ?? []) {
    const id = r.event_id as string;
    markedCount.set(id, (markedCount.get(id) ?? 0) + 1);
  }

  // Roster (current snapshot, no histórico — el cálculo exacto del roster
  // a la fecha del evento se hace en la página de marcado).
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
    return {
      id: e.id,
      club_id: e.club_id,
      team_id: e.team_id,
      team_name: e.teams.name,
      team_color: e.teams.color,
      category_name: e.teams.categories.name,
      category_season: e.teams.categories.season,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      marked_count: markedCount.get(e.id) ?? 0,
      roster_count: rosterCount,
    };
  });
}

/**
 * Carga el detalle de un evento para la pantalla de marcado:
 *  - meta del evento
 *  - roster histórico al día del evento
 *  - asistencia ya registrada (map por player_id)
 */
export async function loadEventAttendance(
  clubId: string,
  role: Role,
  eventId: string
): Promise<EventAttendanceData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, starts_at, ends_at,
       teams!inner(name, color, categories!inner(name, season))`
    )
    .eq('id', eventId)
    .maybeSingle();

  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (ev.type !== 'training') return null;
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
      categories: { name: string; season: string };
    };
  };
  const event = ev as unknown as EventShape;

  // Validar visibilidad por scope.
  const scope = await resolveAsistenciaScope(clubId, role);
  if (scope.kind === 'none') return null;
  if (
    scope.kind === 'restricted' &&
    !scope.teamIds.includes(event.team_id)
  )
    return null;

  // Roster histórico al día del evento.
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

  // Jugador: filtrar a sus propios jugadores.
  const visibleRoster =
    scope.kind === 'player'
      ? activeRoster.filter((r) => scope.playerIds.includes(r.player_id))
      : activeRoster;

  // Asistencia ya registrada.
  const { data: attRows } = await supabase
    .from('training_attendance')
    .select(
      'id, event_id, player_id, code, notes, recorded_by, recorded_at, updated_at'
    )
    .eq('event_id', eventId);

  const attendance = new Map<string, AttendanceRow>();
  for (const r of (attRows ?? []) as AttendanceRow[]) {
    attendance.set(r.player_id, r);
  }

  // canRecord: roles staff con team activo correspondiente. La policy en BD
  // es la verdad; aquí lo precomputamos para esconder/mostrar UI.
  const canRecord =
    WRITE_ROLES.includes(role) &&
    (scope.kind === 'all' ||
      (scope.kind === 'restricted' && scope.teamIds.includes(event.team_id)));

  // Pre-computed aquí (server) para no llamar Date.now() en el render del
  // page.tsx — react-hooks/purity lo flagea aunque sea un Server Component.
  const isFuture = new Date(event.starts_at).getTime() > Date.now();

  return {
    event: {
      id: event.id,
      club_id: event.club_id,
      team_id: event.team_id,
      team_name: event.teams.name,
      team_color: event.teams.color,
      category_name: event.teams.categories.name,
      category_season: event.teams.categories.season,
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
      }))
      .sort((a, b) =>
        (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
          sensitivity: 'base',
        })
      ),
    attendance,
    canRecord,
    isFuture,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats (F4.8)
// ─────────────────────────────────────────────────────────────────────────────

export type StatsRange = '7d' | '30d' | 'season' | 'custom';

export type StatsFilters = {
  range: StatsRange;
  customStart?: string;
  customEnd?: string;
  teamId?: string;
};

export type PlayerStat = {
  player_id: string;
  first_name: string;
  last_name: string;
  team_id: string;
  team_name: string;
  total: number;
  present: number;
  justified: number;
  unjustified: number;
  partial: number;
  pct_present: number;
};

export type CodeBucket = {
  code: AttendanceCode;
  count: number;
  pct: number;
};

export type AsistenciaStats = {
  byPlayer: PlayerStat[];
  byCode: CodeBucket[];
  totalRecorded: number;
};

function rangeToWindow(
  filters: StatsFilters
): { startIso: string; endIso: string } {
  const now = new Date();
  if (filters.range === 'custom' && filters.customStart && filters.customEnd) {
    return {
      startIso: new Date(`${filters.customStart}T00:00:00Z`).toISOString(),
      endIso: new Date(`${filters.customEnd}T23:59:59Z`).toISOString(),
    };
  }
  if (filters.range === '7d') {
    return {
      startIso: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  if (filters.range === '30d') {
    return {
      startIso: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  // 'season' — usa el 1 de agosto del año actual o anterior.
  const year =
    now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    startIso: new Date(Date.UTC(year, 7, 1)).toISOString(),
    endIso: now.toISOString(),
  };
}

export async function loadAsistenciaStats(
  clubId: string,
  role: Role,
  filters: StatsFilters
): Promise<AsistenciaStats> {
  const scope = await resolveAsistenciaScope(clubId, role);
  if (scope.kind === 'none') {
    return { byPlayer: [], byCode: [], totalRecorded: 0 };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { startIso, endIso } = rangeToWindow(filters);

  // Trae filas de training_attendance con join al evento (para filtrar club
  // + team + ventana temporal) y al player (para nombre).
  let q = supabase
    .from('training_attendance')
    .select(
      `id, event_id, player_id, code,
       events!inner(id, club_id, team_id, starts_at,
                    teams!inner(id, name)),
       players!inner(id, first_name, last_name)`
    )
    .gte('events.starts_at', startIso)
    .lte('events.starts_at', endIso);

  if (filters.teamId) {
    q = q.eq('events.team_id', filters.teamId);
  }

  const { data: rawRows } = await q;

  type StatRow = {
    code: AttendanceCode;
    player_id: string;
    events: {
      club_id: string;
      team_id: string;
      teams: { id: string; name: string };
    };
    players: { id: string; first_name: string; last_name: string };
  };
  const rows = (rawRows ?? [])
    .map((r) => r as unknown as StatRow)
    .filter((r) => r.events.club_id === clubId);

  // Aplica scope.
  const filteredRows = rows.filter((r) => {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'restricted')
      return scope.teamIds.includes(r.events.team_id);
    if (scope.kind === 'player')
      return scope.playerIds.includes(r.player_id);
    return false;
  });

  const totalRecorded = filteredRows.length;

  // Bucket por código.
  const codeCounts = new Map<AttendanceCode, number>();
  for (const r of filteredRows) {
    codeCounts.set(r.code, (codeCounts.get(r.code) ?? 0) + 1);
  }
  const byCode: CodeBucket[] = Array.from(codeCounts.entries())
    .map(([code, count]) => ({
      code,
      count,
      pct: totalRecorded > 0 ? (count / totalRecorded) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Bucket por jugador.
  const playerAgg = new Map<
    string,
    {
      player_id: string;
      first_name: string;
      last_name: string;
      team_id: string;
      team_name: string;
      total: number;
      present: number;
      justified: number;
      unjustified: number;
      partial: number;
    }
  >();

  for (const r of filteredRows) {
    let p = playerAgg.get(r.player_id);
    if (!p) {
      p = {
        player_id: r.player_id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        team_id: r.events.teams.id,
        team_name: r.events.teams.name,
        total: 0,
        present: 0,
        justified: 0,
        unjustified: 0,
        partial: 0,
      };
      playerAgg.set(r.player_id, p);
    }
    p.total++;
    switch (r.code) {
      case 'presente':
        p.present++;
        break;
      case 'ausente':
        p.unjustified++;
        break;
      case 'entreno_diferenciado':
        p.partial++;
        break;
      default:
        p.justified++;
        break;
    }
  }

  const byPlayer: PlayerStat[] = Array.from(playerAgg.values())
    .map((p) => ({
      ...p,
      pct_present: p.total > 0 ? (p.present / p.total) * 100 : 0,
    }))
    .sort((a, b) =>
      (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
        sensitivity: 'base',
      })
    );

  return { byPlayer, byCode, totalRecorded };
}
