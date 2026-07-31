import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MANAGEABLE_MATCH_TYPES } from '../events/types';
import { getFormation, defaultLineupDraft } from '../lineups/formations';
import type { TeamFormat } from '../lineups/types';
import { getSportingNamesFromClient } from '../player-profile/sporting-names';
import { computeScore } from './score';
import { aggregateMatchTeamStats, type MatchTeamStats } from './team-events';
import type { ClockPeriod, PeriodKind } from './clock';

/**
 * O2-5 B2 — DETALLE de un directo (SOLO LECTURA), extraído de
 * `apps/web/.../directos/queries.ts` (`loadMatchDetail`). La RLS F7B-2 abre la
 * lectura de match_state/periods/lineups/lineup_positions/events a cualquier
 * miembro del club (y al SEGUIDOR club-wide, F14C). Reutiliza el motor puro de
 * match/* (computeScore, aggregateMatchTeamStats, getFormation) — solo el FETCH se
 * extrae; el cálculo del reloj/fase lo hace el caller con `matchPhase`.
 */
type DbClient = SupabaseClient<Database>;

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
  label: string; // nombre del jugador propio o "#dorsal" del rival
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

/**
 * Detalle del directo del evento `eventId`, acotado al club `clubId` (aislamiento
 * entre clubs, igual que web). `opts.viewerIsSpectator` resuelve nombres desde
 * `players_sporting` (el seguidor no lee `players` por RLS). Devuelve null si el
 * evento no existe/no es visible (RLS), no es del club, o no es un tipo de partido.
 */
export async function getMatchDetailFromClient(
  supabase: DbClient,
  clubId: string,
  eventId: string,
  opts?: { viewerIsSpectator?: boolean }
): Promise<MatchDetail | null> {
  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, opponent_name, starts_at,
       teams!inner(name, color, format, categories!inner(name, half_duration_minutes))`
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (!(MANAGEABLE_MATCH_TYPES as readonly string[]).includes(ev.type as string)) {
    return null;
  }

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
      'period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended'
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

  // Alineación oficial → campo (posiciones); override con live_positions. El
  // SEGUIDOR omite el embed `players!inner` (RLS) y resuelve nombre/dorsal desde
  // `players_sporting`; los borradores (is_official=false) siguen cerrados.
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
    const posSelect = opts?.viewerIsSpectator
      ? 'player_id, position_code, x_pct, y_pct'
      : 'player_id, position_code, x_pct, y_pct, players!inner(first_name, last_name, dorsal)';
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select(posSelect)
      .eq('lineup_id', officialRow.id as string)
      .eq('location', 'field');
    type PosShape = {
      player_id: string;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
      players: { first_name: string; last_name: string | null; dorsal: number | null } | null;
    };
    const posArr = (posRows ?? []) as unknown as PosShape[];
    const posNames = opts?.viewerIsSpectator
      ? await getSportingNamesFromClient(
          supabase,
          posArr.map((p) => p.player_id)
        )
      : null;
    fieldPlayers = posArr.map((p) => {
      const live = livePositions[p.player_id];
      const n = posNames != null ? posNames.get(p.player_id) : p.players;
      return {
        playerId: p.player_id,
        label: n?.last_name || n?.first_name || p.player_id.slice(0, 4),
        dorsal: n?.dorsal ?? null,
        positionCode: live?.position_code ?? p.position_code,
        xPct: live?.x_pct ?? (p.x_pct == null ? null : Number(p.x_pct)),
        yPct: live?.y_pct ?? (p.y_pct == null ? null : Number(p.y_pct)),
      };
    });
  }
  if (!formationCode || !getFormation(formationCode)) {
    formationCode = defaultLineupDraft(event.teams.format).formationCode;
  }

  // Todos los eventos (cronológico) — nombre del jugador propio (players!inner para
  // el miembro; players_sporting para el seguidor).
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
  const evtSelect = opts?.viewerIsSpectator
    ? `id, side, type, player_id, rival_dorsal, clock_seconds, display_minute, period, metadata`
    : `id, side, type, player_id, rival_dorsal, clock_seconds, display_minute, period, metadata,
       players!match_events_player_id_fkey(first_name, last_name, dorsal)`;
  const { data: evtRows } = await supabase
    .from('match_events')
    .select(evtSelect)
    .eq('event_id', eventId)
    .order('clock_seconds', { ascending: true })
    .order('created_at', { ascending: true });
  const rows = (evtRows ?? []) as unknown as EvtShape[];

  const evtNames = opts?.viewerIsSpectator
    ? await getSportingNamesFromClient(
        supabase,
        rows.map((r) => r.player_id)
      )
    : null;

  const events: DetailEvent[] = rows.map((r) => {
    const own = evtNames != null ? evtNames.get(r.player_id ?? '') : r.players;
    return {
      id: r.id,
      side: r.side,
      type: r.type,
      label:
        r.side === 'rival'
          ? `#${r.rival_dorsal ?? '?'}`
          : own?.last_name || own?.first_name || '—',
      clockSeconds: r.clock_seconds,
      displayMinute: r.display_minute,
      period: r.period,
    };
  });

  // Marcador + agregados de equipo, reusando el motor puro de core.
  const score = computeScore(
    rows.map((r) => ({ side: r.side, type: r.type, outcome: r.metadata?.outcome ?? null }))
  );
  const teamStats = aggregateMatchTeamStats(
    rows.map((r) => ({
      side: r.side,
      type: r.type,
      foulKind: r.metadata?.foul_kind ?? null,
      cornerSide: r.metadata?.corner_side ?? null,
    }))
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
