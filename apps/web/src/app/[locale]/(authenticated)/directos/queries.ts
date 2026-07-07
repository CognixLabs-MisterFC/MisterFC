/**
 * F7B-3 — Carga de la pantalla "Directos" (SOLO LECTURA). No usa el gate de
 * staff (user_can_record_match): la RLS de F7B-2 ya abre la lectura de
 * match_state/periods/starters/events y lineups/lineup_positions a cualquier
 * miembro del club. Reutiliza el motor puro de @misterfc/core (matchPhase,
 * computeScore, aggregateMatchTeamStats) para no duplicar lógica.
 */

import {
  createSupabaseServerClient,
  MATCH_SURFACE_TYPES,
  defaultLineupDraft,
  getFormation,
  computeScore,
  aggregateMatchTeamStats,
  type ClockPeriod,
  type PeriodKind,
  type TeamFormat,
  type MatchTeamStats,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/** Un partido de la semana para la LISTA. */
export type WeekMatch = {
  eventId: string;
  title: string;
  teamName: string;
  teamColor: string;
  categoryName: string;
  opponentName: string | null;
  startsAt: string;
  halfDurationMinutes: number;
  status: 'not_started' | 'live' | 'closed';
  /** Marcador (propio-rival). null si aún no ha empezado. */
  goalsOwn: number | null;
  goalsRival: number | null;
  /** Reloj persistido (solo para partidos en vivo; [] en el resto). */
  periods: ClockPeriod[];
};

type StateRow = {
  event_id: string;
  status: 'not_started' | 'live' | 'closed';
  goals_for: number | null;
  goals_against: number | null;
};

type PeriodRow = {
  event_id: string;
  period: PeriodKind;
  ordinal: number;
  base_offset_seconds: number;
  accumulated_seconds: number;
  running: boolean;
  last_started_at: string | null;
  ended: boolean;
};

type GoalRow = {
  event_id: string;
  side: 'own' | 'rival';
  type: string;
  metadata: { outcome?: string } | null;
};

/** Límites de la semana natural (lun 00:00 → lun siguiente 00:00) que contiene `now`. */
export function weekBounds(now: Date): { startIso: string; endIso: string } {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  const dayFromMonday = (monday.getDay() + 6) % 7; // 0 = lunes
  monday.setDate(monday.getDate() - dayFromMonday);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { startIso: monday.toISOString(), endIso: nextMonday.toISOString() };
}

/** ¿Un gol del partido? (goal, o penalty 'scored'; la tanda no cuenta). */
function countsAsGoal(g: GoalRow): boolean {
  return g.type === 'goal' || (g.type === 'penalty' && g.metadata?.outcome === 'scored');
}

/**
 * Partidos (match/friendly, incl. sub-partidos de torneo) de la semana natural
 * del club, con estado y marcador. Orden: en directo primero, luego por hora.
 */
export async function loadWeekMatches(clubId: string): Promise<WeekMatch[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { startIso, endIso } = weekBounds(new Date());

  const { data: evRows } = await supabase
    .from('events')
    .select(
      `id, team_id, title, opponent_name, starts_at, type,
       teams!inner(name, color, format, categories!inner(name, half_duration_minutes))`,
    )
    .eq('club_id', clubId)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', startIso)
    .lt('starts_at', endIso)
    .order('starts_at', { ascending: true });

  type EvRow = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      categories: { name: string; half_duration_minutes: number | null };
    };
  };
  const events = (evRows ?? []) as unknown as EvRow[];
  if (events.length === 0) return [];

  const ids = events.map((e) => e.id);

  const { data: stateRows } = await supabase
    .from('match_state')
    .select('event_id, status, goals_for, goals_against')
    .in('event_id', ids);
  const stateByEvent = new Map<string, StateRow>();
  for (const s of (stateRows ?? []) as StateRow[]) stateByEvent.set(s.event_id, s);

  const liveIds = (stateRows ?? [])
    .filter((s) => (s as StateRow).status === 'live')
    .map((s) => (s as StateRow).event_id);

  // Reloj + goles solo de los partidos en vivo (marcador en vivo se deriva de
  // match_events; en cerrados usamos match_state.goals_*).
  const periodsByEvent = new Map<string, ClockPeriod[]>();
  const liveGoals = new Map<string, { own: number; rival: number }>();
  if (liveIds.length > 0) {
    const { data: perRows } = await supabase
      .from('match_periods')
      .select(
        'event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended',
      )
      .in('event_id', liveIds)
      .order('ordinal', { ascending: true });
    for (const r of (perRows ?? []) as PeriodRow[]) {
      const arr = periodsByEvent.get(r.event_id) ?? [];
      arr.push({
        period: r.period,
        ordinal: r.ordinal,
        baseOffsetSeconds: r.base_offset_seconds,
        accumulatedSeconds: r.accumulated_seconds,
        running: r.running,
        lastStartedAt: r.last_started_at,
        ended: r.ended,
      });
      periodsByEvent.set(r.event_id, arr);
    }

    const { data: goalRows } = await supabase
      .from('match_events')
      .select('event_id, side, type, metadata')
      .in('event_id', liveIds)
      .in('type', ['goal', 'penalty']);
    for (const g of (goalRows ?? []) as GoalRow[]) {
      if (!countsAsGoal(g)) continue;
      const cur = liveGoals.get(g.event_id) ?? { own: 0, rival: 0 };
      if (g.side === 'own') cur.own += 1;
      else cur.rival += 1;
      liveGoals.set(g.event_id, cur);
    }
  }

  const out: WeekMatch[] = events.map((e) => {
    const st = stateByEvent.get(e.id);
    const status = st?.status ?? 'not_started';
    let goalsOwn: number | null = null;
    let goalsRival: number | null = null;
    if (status === 'live') {
      const g = liveGoals.get(e.id) ?? { own: 0, rival: 0 };
      goalsOwn = g.own;
      goalsRival = g.rival;
    } else if (status === 'closed') {
      goalsOwn = st?.goals_for ?? 0;
      goalsRival = st?.goals_against ?? 0;
    }
    return {
      eventId: e.id,
      title: e.title,
      teamName: e.teams.name,
      teamColor: e.teams.color,
      categoryName: e.teams.categories.name,
      opponentName: e.opponent_name,
      startsAt: e.starts_at,
      halfDurationMinutes: e.teams.categories.half_duration_minutes ?? 45,
      status,
      goalsOwn,
      goalsRival,
      periods: periodsByEvent.get(e.id) ?? [],
    };
  });

  // En directo primero; dentro de cada grupo, por hora de inicio ascendente.
  return out.sort((a, b) => {
    const la = a.status === 'live' ? 0 : 1;
    const lb = b.status === 'live' ? 0 : 1;
    if (la !== lb) return la - lb;
    return a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalle
// ─────────────────────────────────────────────────────────────────────────────

export type DetailFieldPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
};

export type DetailEvent = {
  id: string;
  side: 'own' | 'rival';
  type: string;
  label: string; // nombre del jugador propio o "Rival #dorsal"
  clockSeconds: number;
  displayMinute: number | null;
  period: PeriodKind;
};

export type MatchDetail = {
  eventId: string;
  title: string;
  teamName: string;
  teamColor: string;
  categoryName: string;
  opponentName: string | null;
  startsAt: string;
  format: TeamFormat;
  halfDurationMinutes: number;
  status: 'not_started' | 'live' | 'closed';
  periods: ClockPeriod[];
  formationCode: string;
  fieldPlayers: DetailFieldPlayer[];
  hasLineup: boolean;
  /** Marcador derivado de match_events (goal + penalty 'scored'). */
  goalsOwn: number;
  goalsRival: number;
  /** Agregados de equipo (córners/faltas/tiros/tarjetas/offsides). */
  teamStats: MatchTeamStats;
  /** Todos los match_events del partido (lista cronológica). */
  events: DetailEvent[];
};

export async function loadMatchDetail(
  clubId: string,
  eventId: string,
): Promise<MatchDetail | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, opponent_name, starts_at,
       teams!inner(name, color, format, categories!inner(name, half_duration_minutes))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (!(MATCH_SURFACE_TYPES as readonly string[]).includes(ev.type as string)) return null;

  type EvShape = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      format: TeamFormat;
      categories: { name: string; half_duration_minutes: number | null };
    };
  };
  const event = ev as unknown as EvShape;

  // Estado + reloj.
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, live_positions')
    .eq('event_id', eventId)
    .maybeSingle();
  const status =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ??
    'not_started';
  const livePositions =
    (stateRow?.live_positions as Record<
      string,
      { position_code?: string; x_pct?: number; y_pct?: number }
    > | null) ?? {};

  const { data: perRows } = await supabase
    .from('match_periods')
    .select(
      'period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended',
    )
    .eq('event_id', eventId)
    .order('ordinal', { ascending: true });
  const periods: ClockPeriod[] = (perRows ?? []).map((r) => ({
    period: r.period as PeriodKind,
    ordinal: r.ordinal as number,
    baseOffsetSeconds: r.base_offset_seconds as number,
    accumulatedSeconds: r.accumulated_seconds as number,
    running: r.running as boolean,
    lastStartedAt: (r.last_started_at as string | null) ?? null,
    ended: r.ended as boolean,
  }));

  // Alineación oficial → campo (posiciones); override con live_positions.
  let formationCode: string | null = null;
  let fieldPlayers: DetailFieldPlayer[] = [];
  const { data: officialRow } = await supabase
    .from('lineups')
    .select('id, formation_code')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();
  if (officialRow) {
    formationCode = officialRow.formation_code as string;
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select(
        'player_id, position_code, x_pct, y_pct, players!inner(first_name, last_name, dorsal)',
      )
      .eq('lineup_id', officialRow.id as string)
      .eq('location', 'field');
    type PosShape = {
      player_id: string;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
      players: { first_name: string; last_name: string | null; dorsal: number | null };
    };
    fieldPlayers = ((posRows ?? []) as unknown as PosShape[]).map((p) => {
      const live = livePositions[p.player_id];
      return {
        playerId: p.player_id,
        label: p.players.last_name || p.players.first_name || p.player_id.slice(0, 4),
        dorsal: p.players.dorsal,
        positionCode: live?.position_code ?? p.position_code,
        xPct: live?.x_pct ?? (p.x_pct == null ? null : Number(p.x_pct)),
        yPct: live?.y_pct ?? (p.y_pct == null ? null : Number(p.y_pct)),
      };
    });
  }
  if (!formationCode || !getFormation(formationCode)) {
    formationCode = defaultLineupDraft(event.teams.format).formationCode;
  }

  // Todos los eventos (cronológico) — con nombre del jugador propio.
  const { data: evtRows } = await supabase
    .from('match_events')
    .select(
      `id, side, type, player_id, rival_dorsal, clock_seconds, display_minute, period, metadata,
       players!match_events_player_id_fkey(first_name, last_name, dorsal)`,
    )
    .eq('event_id', eventId)
    .order('clock_seconds', { ascending: true })
    .order('created_at', { ascending: true });
  type EvtShape = {
    id: string;
    side: 'own' | 'rival';
    type: string;
    player_id: string | null;
    rival_dorsal: number | null;
    clock_seconds: number;
    display_minute: number | null;
    period: PeriodKind;
    metadata: { outcome?: string; foul_kind?: string; corner_side?: string } | null;
    players: { first_name: string; last_name: string | null; dorsal: number | null } | null;
  };
  const rows = (evtRows ?? []) as unknown as EvtShape[];

  const events: DetailEvent[] = rows.map((r) => ({
    id: r.id,
    side: r.side,
    type: r.type,
    label:
      r.side === 'rival'
        ? `#${r.rival_dorsal ?? '?'}`
        : r.players?.last_name || r.players?.first_name || '—',
    clockSeconds: r.clock_seconds,
    displayMinute: r.display_minute,
    period: r.period,
  }));

  // Marcador + agregados de equipo, reusando el motor puro de core.
  const score = computeScore(
    rows.map((r) => ({ side: r.side, type: r.type, outcome: r.metadata?.outcome ?? null })),
  );
  const teamStats = aggregateMatchTeamStats(
    rows.map((r) => ({
      side: r.side,
      type: r.type,
      foulKind: r.metadata?.foul_kind ?? null,
      cornerSide: r.metadata?.corner_side ?? null,
    })),
  );

  return {
    eventId: event.id,
    title: event.title,
    teamName: event.teams.name,
    teamColor: event.teams.color,
    categoryName: event.teams.categories.name,
    opponentName: event.opponent_name,
    startsAt: event.starts_at,
    format: event.teams.format,
    halfDurationMinutes: event.teams.categories.half_duration_minutes ?? 45,
    status,
    periods,
    formationCode,
    fieldPlayers,
    hasLineup: officialRow != null,
    goalsOwn: score.own,
    goalsRival: score.rival,
    teamStats,
    events,
  };
}
