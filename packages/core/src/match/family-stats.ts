/**
 * O2-5 E1 — Estadísticas de partido para la FAMILIA (fila del hijo), extraídas de
 * `apps/web/.../estadisticas/queries.ts` (rama `!STAFF_ROLES`, D9-1). SOLO LECTURA
 * de `match_player_stats` (consolidado 7.10). Sin `match_events`/`match_state`
 * (staff-only): la familia no puede leerlos por RLS. "Sin filas" = sin datos
 * (las filas solo existen al cerrar el partido).
 *
 * La web pasa a delegar su rama familia en estas funciones (comportamiento
 * idéntico); la app nativa las consume bajo el HIJO ACTIVO. La RLS acota.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { TeamFormat } from '../lineups/types';

type Sb = SupabaseClient<Database>;

/** Espejo de una fila consolidada de `match_player_stats`. */
export type FamilyMatchStatRow = {
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

export type MatchStatsHeader = {
  id: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  teamName: string;
  format: TeamFormat;
};

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

/** Titulares primero, luego por dorsal, luego por apellido. */
function sortRows(rows: FamilyMatchStatRow[]): FamilyMatchStatRow[] {
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

function toRow(
  stat: StatShape,
  name: PlayerNameShape | undefined,
): FamilyMatchStatRow {
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

/** Cabecera del evento (legible por miembros del club). null si no existe. */
export async function getMatchStatsHeaderFromClient(
  supabase: Sb,
  clubId: string,
  eventId: string,
): Promise<MatchStatsHeader | null> {
  const { data: ev } = await supabase
    .from('events')
    .select(`id, club_id, title, opponent_name, starts_at, teams!inner(name, format)`)
    .eq('id', eventId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!ev) return null;
  const e = ev as unknown as {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: { name: string; format: TeamFormat };
  };
  return {
    id: e.id,
    title: e.title,
    opponentName: e.opponent_name,
    startsAt: e.starts_at,
    teamName: e.teams.name,
    format: e.teams.format,
  };
}

/**
 * Filas consolidadas del partido para `playerIds` (los hijos). Vacío = el hijo no
 * participó o el partido no está cerrado. Ordenadas (titulares/dorsal/apellido).
 */
export async function getFamilyMatchStatRowsFromClient(
  supabase: Sb,
  eventId: string,
  playerIds: readonly string[],
): Promise<FamilyMatchStatRow[]> {
  if (playerIds.length === 0) return [];

  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(STAT_SELECT)
    .eq('event_id', eventId)
    .in('player_id', playerIds as string[]);
  const stats = (statRows ?? []) as unknown as StatShape[];
  if (stats.length === 0) return [];

  const ids = stats.map((s) => s.player_id);
  const { data: nameRows } = await supabase
    .from('players')
    .select('id, first_name, last_name, dorsal')
    .in('id', ids);
  const names = new Map<string, PlayerNameShape>();
  for (const n of (nameRows ?? []) as unknown as PlayerNameShape[]) {
    names.set(n.id, n);
  }

  return sortRows(stats.map((s) => toRow(s, names.get(s.player_id))));
}
