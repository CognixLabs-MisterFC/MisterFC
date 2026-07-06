/**
 * F7.x (X.1) — Carga de la VISTA DE ESTADÍSTICAS del partido.
 *
 * Cara de consulta de lo que F7 ya captura (no recalcula): lee filas
 * consolidadas (`match_player_stats`, 7.10) y, para el staff, los eventos de
 * equipo (`match_events`) que `aggregateMatchTeamStats` (X.0) agrega.
 *
 * Gating (D4 de la spec 7.x), sin tocar RLS:
 *  - STAFF (admin/coord + cuerpo técnico del equipo, vía `user_can_record_match`)
 *    ve TODO: tabla por jugador + panel de equipo (ambos bandos) + marcador.
 *  - FAMILIA/jugador (rol `jugador`) ve SOLO la fila de su(s) hijo(s): el loader
 *    NO lee `match_events` ni `match_state` (staff-only); lee su
 *    `match_player_stats` por la policy player-scoped (🔒 D9-1). Sin marcador ni
 *    panel de equipo (no puede leerlos).
 *
 * Solo partidos cerrados: el staff lo comprueba con `match_state.status`; la
 * familia no lee `match_state`, pero las filas de `match_player_stats` solo
 * EXISTEN al cerrar (consolidación 7.10), así que "sin filas" = sin datos.
 */

import {
  STAFF_ROLES,
  aggregateMatchTeamStats,
  createSupabaseServerClient,
  formatPlayerNameNatural,
  type MatchTeamStatEvent,
  type MatchTeamStats,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { MatchTimelineEntry } from '@/components/match/match-timeline';
import type { Role } from '../../../jugadores/queries';

/** Stats consolidadas de un jugador en el partido (espejo de match_player_stats). */
export type MatchStatRow = {
  playerId: string;
  firstName: string;
  lastName: string | null;
  dorsal: number | null;
  started: boolean;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  shots: number;
  foulsCommitted: number;
  foulsReceived: number;
  penaltiesScored: number;
  penaltiesMissed: number;
};

type EventHeader = {
  id: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  teamName: string;
  format: TeamFormat;
};

/** Resultado de la carga, discriminado para que la página decida el render. */
export type MatchStatsResult =
  | {
      status: 'ok';
      view:
        | {
            viewer: 'staff';
            event: EventHeader;
            score: { own: number | null; against: number | null };
            players: MatchStatRow[];
            team: MatchTeamStats;
            timeline: MatchTimelineEntry[];
          }
        | {
            viewer: 'family';
            event: EventHeader;
            players: MatchStatRow[];
          };
    }
  | { status: 'not_closed' } // staff: el partido aún no está cerrado
  | { status: 'empty' } // familia: sin stats de su hijo (no participó / no cerrado)
  | { status: 'forbidden' }
  | { status: 'not_found' };

const STAT_SELECT =
  `player_id, started, minutes_played, goals, assists, yellow_cards,
   red_cards, shots, fouls_committed, fouls_received,
   penalties_scored, penalties_missed`;

type StatShape = {
  player_id: string;
  started: boolean;
  minutes_played: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  shots: number;
  fouls_committed: number;
  fouls_received: number;
  penalties_scored: number;
  penalties_missed: number;
};

type PlayerNameShape = {
  id: string;
  first_name: string;
  last_name: string | null;
  dorsal: number | null;
};

/** Ordena: titulares primero, luego por dorsal, luego por apellido. */
function sortRows(rows: MatchStatRow[]): MatchStatRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.started ? 0 : 1;
    const sb = b.started ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const da = a.dorsal ?? 999;
    const db = b.dorsal ?? 999;
    if (da !== db) return da - db;
    return (a.lastName ?? '').localeCompare(b.lastName ?? '', 'es', {
      sensitivity: 'base',
    });
  });
}

function toRow(stat: StatShape, name: PlayerNameShape | undefined): MatchStatRow {
  return {
    playerId: stat.player_id,
    firstName: name?.first_name ?? '',
    lastName: name?.last_name ?? null,
    dorsal: name?.dorsal ?? null,
    started: stat.started,
    minutesPlayed: stat.minutes_played,
    goals: stat.goals,
    assists: stat.assists,
    yellowCards: stat.yellow_cards,
    redCards: stat.red_cards,
    shots: stat.shots,
    foulsCommitted: stat.fouls_committed,
    foulsReceived: stat.fouls_received,
    penaltiesScored: stat.penalties_scored,
    penaltiesMissed: stat.penalties_missed,
  };
}

export async function loadMatchStats(
  clubId: string,
  eventId: string,
  userId: string,
  role: Role,
): Promise<MatchStatsResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Cabecera del evento (legible por miembros del club).
  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, title, opponent_name, starts_at, teams!inner(name, format)`,
    )
    .eq('id', eventId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!ev) return { status: 'not_found' };
  type EventShape = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: { name: string; format: TeamFormat };
  };
  const e = ev as unknown as EventShape;
  const event: EventHeader = {
    id: e.id,
    title: e.title,
    opponentName: e.opponent_name,
    startsAt: e.starts_at,
    teamName: e.teams.name,
    format: e.teams.format,
  };

  // ── FAMILIA / jugador: solo la fila de su(s) hijo(s). Sin match_events ni
  //    match_state (staff-only). ────────────────────────────────────────────
  if (!STAFF_ROLES.includes(role)) {
    const { data: accounts } = await supabase
      .from('player_accounts')
      .select('player_id')
      .eq('profile_id', userId);
    const playerIds = (accounts ?? []).map((a) => a.player_id as string);
    if (playerIds.length === 0) return { status: 'empty' };

    const { data: statRows } = await supabase
      .from('match_player_stats')
      .select(STAT_SELECT)
      .eq('event_id', eventId)
      .in('player_id', playerIds);
    const stats = (statRows ?? []) as unknown as StatShape[];
    if (stats.length === 0) return { status: 'empty' };

    const ids = stats.map((s) => s.player_id);
    const { data: nameRows } = await supabase
      .from('players')
      .select('id, first_name, last_name, dorsal')
      .in('id', ids);
    const names = new Map<string, PlayerNameShape>();
    for (const n of (nameRows ?? []) as unknown as PlayerNameShape[]) {
      names.set(n.id, n);
    }

    const players = sortRows(stats.map((s) => toRow(s, names.get(s.player_id))));
    return { status: 'ok', view: { viewer: 'family', event, players } };
  }

  // ── STAFF: permiso autoritativo + partido cerrado + todo. ──────────────────
  const { data: canRecord } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  if (canRecord !== true) return { status: 'forbidden' };

  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, goals_for, goals_against')
    .eq('event_id', eventId)
    .maybeSingle();
  const status =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ??
    'not_started';
  if (status !== 'closed') return { status: 'not_closed' };

  // Stats por jugador (todas las del partido).
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(STAT_SELECT)
    .eq('event_id', eventId);
  const stats = (statRows ?? []) as unknown as StatShape[];

  let players: MatchStatRow[] = [];
  if (stats.length > 0) {
    const ids = stats.map((s) => s.player_id);
    const { data: nameRows } = await supabase
      .from('players')
      .select('id, first_name, last_name, dorsal')
      .in('id', ids);
    const names = new Map<string, PlayerNameShape>();
    for (const n of (nameRows ?? []) as unknown as PlayerNameShape[]) {
      names.set(n.id, n);
    }
    players = sortRows(stats.map((s) => toRow(s, names.get(s.player_id))));
  }

  // match_events del partido en UNA carga: alimenta los agregados de equipo
  // (X.0) y la línea de tiempo read-only (X.2). Dos FKs a players (actor y el
  // que entra en una sustitución) vía alias del join.
  const { data: eventRows } = await supabase
    .from('match_events')
    .select(
      `id, side, type, player_id, rival_dorsal, related_player_id,
       clock_seconds, display_minute, metadata,
       actor:players!match_events_player_id_fkey(first_name, last_name, dorsal),
       sub_in:players!match_events_related_player_id_fkey(first_name, last_name, dorsal)`,
    )
    .eq('event_id', eventId)
    .order('clock_seconds', { ascending: true })
    .order('created_at', { ascending: true });
  type PlayerJoin = {
    first_name: string;
    last_name: string | null;
    dorsal: number | null;
  } | null;
  type RawEvent = {
    id: string;
    side: 'own' | 'rival';
    type: string;
    player_id: string | null;
    rival_dorsal: number | null;
    related_player_id: string | null;
    clock_seconds: number;
    display_minute: number | null;
    metadata: {
      foul_kind?: string | null;
      corner_side?: string | null;
      outcome?: string | null;
      from?: string | null;
      to?: string | null;
    } | null;
    actor: PlayerJoin;
    sub_in: PlayerJoin;
  };
  const raw = (eventRows ?? []) as unknown as RawEvent[];

  // Agregados de equipo (ambos bandos) — X.0.
  const teamEvents: MatchTeamStatEvent[] = raw.map((r) => ({
    side: r.side,
    type: r.type,
    foulKind: r.metadata?.foul_kind ?? null,
    cornerSide: r.metadata?.corner_side ?? null,
  }));
  const team = aggregateMatchTeamStats(teamEvents);

  // Línea de tiempo read-only — X.2. Etiqueta del actor = "dorsal · Nombre Apellido".
  const labelOf = (p: PlayerJoin, dorsal: number | null): string | null => {
    if (!p) return null;
    const name = formatPlayerNameNatural(p.first_name, p.last_name);
    const d = dorsal ?? p.dorsal;
    return d != null ? `${d} · ${name}` : name;
  };
  const timeline: MatchTimelineEntry[] = raw.map((r) => ({
    id: r.id,
    side: r.side,
    type: r.type,
    displayMinute: r.display_minute,
    clockSeconds: r.clock_seconds,
    playerLabel: labelOf(r.actor, null),
    rivalDorsal: r.rival_dorsal,
    relatedPlayerLabel: labelOf(r.sub_in, null),
    outcome: r.metadata?.outcome ?? null,
    foulKind: r.metadata?.foul_kind ?? null,
    cornerSide: r.metadata?.corner_side ?? null,
    formationFrom: r.metadata?.from ?? null,
    formationTo: r.metadata?.to ?? null,
  }));

  return {
    status: 'ok',
    view: {
      viewer: 'staff',
      event,
      score: {
        own: (stateRow?.goals_for as number | null) ?? null,
        against: (stateRow?.goals_against as number | null) ?? null,
      },
      players,
      team,
      timeline,
    },
  };
}
