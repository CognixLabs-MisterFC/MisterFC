import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MANAGEABLE_MATCH_TYPES } from '../events/types';
import type { ClockPeriod, PeriodKind } from './clock';

/**
 * O2-5 B1 — Listado "Directos" de la semana (SOLO LECTURA), extraído de
 * `apps/web/.../directos/queries.ts` (`loadWeekMatches`). La RLS F7B-2 abre la
 * lectura de match_state/periods/events a cualquier miembro del club. El DETALLE
 * en vivo (campo/alineaciones) es B2 y sigue en apps/web.
 */
type DbClient = SupabaseClient<Database>;

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
  goalsOwn: number | null;
  goalsRival: number | null;
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

function countsAsGoal(g: GoalRow): boolean {
  return g.type === 'goal' || (g.type === 'penalty' && g.metadata?.outcome === 'scored');
}

export async function getWeekMatchesFromClient(
  supabase: DbClient,
  clubId: string,
  opts?: { teamId?: string | null }
): Promise<WeekMatch[]> {
  const { startIso, endIso } = weekBounds(new Date());

  let evQuery = supabase
    .from('events')
    .select(
      `id, team_id, title, opponent_name, starts_at, type,
       teams!inner(name, color, format, categories!inner(name, half_duration_minutes))`
    )
    .eq('club_id', clubId)
    .in('type', MANAGEABLE_MATCH_TYPES)
    .gte('starts_at', startIso)
    .lt('starts_at', endIso);

  // O2-6 — acotar al equipo del jugador seguido (seguidor). Opcional y
  // RETROCOMPATIBLE: familia llama sin `opts` → sin filtro (comportamiento igual).
  if (opts?.teamId) evQuery = evQuery.eq('team_id', opts.teamId);

  const { data: evRows } = await evQuery.order('starts_at', { ascending: true });

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

  const periodsByEvent = new Map<string, ClockPeriod[]>();
  const liveGoals = new Map<string, { own: number; rival: number }>();
  if (liveIds.length > 0) {
    const { data: perRows } = await supabase
      .from('match_periods')
      .select(
        'event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended'
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

  return out.sort((a, b) =>
    a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0
  );
}
