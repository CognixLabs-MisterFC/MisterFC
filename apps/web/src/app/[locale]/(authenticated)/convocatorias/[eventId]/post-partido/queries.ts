/**
 * F8.2 — Carga de la etapa POST-PARTIDO (valoraciones del partido).
 *
 * Etapa terminal del ciclo (spec 8.0 §3): convocatoria → alineación → directo →
 * post-partido → cerrado. Permiso autoritativo vía RPC `user_can_record_match`
 * (mismo helper que la RLS de evaluations / F7): cuerpo técnico del equipo +
 * admin/coord.
 *
 * La lista de jugadores a valorar es la PLANTILLA QUE PARTICIPÓ: las filas
 * materializadas en `match_player_stats` (7.10) — unión con jugadores que ya
 * tengan una valoración (por si el partido se reabrió y editó). Las stats de
 * 7.10 se muestran como CONTEXTO en solo lectura (§6); NO se mezclan con la
 * valoración subjetiva.
 */

import { createSupabaseServerClient, type TeamFormat } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/** Stats objetivas materializadas al cerrar (7.10). Contexto, no valoración. */
export type PostMatchStats = {
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

/** Valoración actual de un jugador (si existe). */
export type PostMatchEvaluation = {
  rating: number | null;
  comment: string | null;
  isMvp: boolean;
};

export type PostMatchPlayer = {
  playerId: string;
  firstName: string;
  lastName: string | null;
  dorsal: number | null;
  /** null si el jugador no tiene fila en match_player_stats (no participó). */
  stats: PostMatchStats | null;
  /** null si aún no se ha valorado. */
  evaluation: PostMatchEvaluation | null;
};

export type PostMatchData = {
  event: {
    id: string;
    title: string;
    opponentName: string | null;
    teamName: string;
    format: TeamFormat;
    type: string;
  };
  /** Estado de la sesión de captura (F7). El formulario solo se abre en 'closed'. */
  matchStatus: 'not_started' | 'live' | 'closed';
  /** F8 §3.5 — etapa de valoraciones completada (nodo "cerrado" del ciclo). */
  postMatchDone: boolean;
  /** Marcador final materializado al cerrar (7.10). null si no hay. */
  score: { own: number | null; against: number | null };
  players: PostMatchPlayer[];
};

export async function loadPostMatch(
  clubId: string,
  eventId: string,
): Promise<PostMatchData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, type, title, opponent_name,
       teams!inner(name, format)`,
    )
    .eq('id', eventId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!ev) return null;

  type EventShape = {
    id: string;
    club_id: string;
    type: string;
    title: string;
    opponent_name: string | null;
    teams: { name: string; format: TeamFormat };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS de evaluations / F7.1).
  const { data: canRecord } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  if (canRecord !== true) return null;

  // Estado + cierre de la etapa + marcador final.
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, post_match_done, goals_for, goals_against')
    .eq('event_id', eventId)
    .maybeSingle();
  const matchStatus =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ??
    'not_started';
  const postMatchDone = (stateRow?.post_match_done as boolean | undefined) ?? false;
  const score = {
    own: (stateRow?.goals_for as number | null) ?? null,
    against: (stateRow?.goals_against as number | null) ?? null,
  };

  // Stats consolidadas (7.10) — contexto por jugador.
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(
      `player_id, started, minutes_played, goals, assists, yellow_cards,
       red_cards, shots, fouls_committed, fouls_received,
       penalties_scored, penalties_missed`,
    )
    .eq('event_id', eventId);
  const statsByPlayer = new Map<string, PostMatchStats>();
  for (const r of statRows ?? []) {
    statsByPlayer.set(r.player_id as string, {
      started: r.started as boolean,
      minutesPlayed: r.minutes_played as number,
      goals: r.goals as number,
      assists: r.assists as number,
      yellowCards: r.yellow_cards as number,
      redCards: r.red_cards as number,
      shots: r.shots as number,
      foulsCommitted: r.fouls_committed as number,
      foulsReceived: r.fouls_received as number,
      penaltiesScored: r.penalties_scored as number,
      penaltiesMissed: r.penalties_missed as number,
    });
  }

  // Valoraciones ya guardadas.
  const { data: evalRows } = await supabase
    .from('evaluations')
    .select('player_id, rating, comment, is_mvp')
    .eq('event_id', eventId);
  const evalByPlayer = new Map<string, PostMatchEvaluation>();
  for (const r of evalRows ?? []) {
    evalByPlayer.set(r.player_id as string, {
      rating: (r.rating as number | null) ?? null,
      comment: (r.comment as string | null) ?? null,
      isMvp: (r.is_mvp as boolean) ?? false,
    });
  }

  // Lista de jugadores = participantes (match_player_stats) ∪ ya valorados.
  const playerIds = new Set<string>([
    ...statsByPlayer.keys(),
    ...evalByPlayer.keys(),
  ]);
  let players: PostMatchPlayer[] = [];
  if (playerIds.size > 0) {
    const { data: playerRows } = await supabase
      .from('players')
      .select('id, first_name, last_name, dorsal')
      .in('id', [...playerIds]);
    players = (playerRows ?? []).map((p) => ({
      playerId: p.id as string,
      firstName: p.first_name as string,
      lastName: (p.last_name as string | null) ?? null,
      dorsal: (p.dorsal as number | null) ?? null,
      stats: statsByPlayer.get(p.id as string) ?? null,
      evaluation: evalByPlayer.get(p.id as string) ?? null,
    }));
    // Orden: titulares primero, luego por dorsal, luego por apellido.
    players.sort((a, b) => {
      const sa = a.stats?.started ? 0 : 1;
      const sb = b.stats?.started ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const da = a.dorsal ?? 999;
      const db = b.dorsal ?? 999;
      if (da !== db) return da - db;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '', 'es', {
        sensitivity: 'base',
      });
    });
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      opponentName: event.opponent_name,
      teamName: event.teams.name,
      format: event.teams.format,
      type: event.type,
    },
    matchStatus,
    postMatchDone,
    score,
    players,
  };
}
