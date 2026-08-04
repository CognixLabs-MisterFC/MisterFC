/**
 * O2-9c — POST-PARTIDO (valoraciones) extraído a core (framework-agnóstico).
 *
 * Cierra CAMPO C: lo que el staff hace DESPUÉS de pitar el final. El CIERRE en sí
 * (status→closed + consolidación de stats + marcador final) ya lo hace 9a
 * (`finishMatchFromClient`/`consolidateMatchAndPersistFromClient`); aquí va la capa
 * SUBJETIVA que va encima: valoración individual (nota 1-10 + comentario + MVP),
 * valoración colectiva del equipo, y el flag de etapa completada (post_match_done).
 *
 * Read (`getPostMatchFromClient`) y writes se extraen de la web (F8.2/8.3):
 * `apps/web/.../post-partido/{queries,actions}.ts`, que pasan a DELEGAR aquí sin
 * cambiar su comportamiento. El modelo de datos (tablas `evaluations`/
 * `team_evaluations`, schemas Zod) YA existe en core (F8) y NO se reimplementa.
 *
 * Escritura DIRECTA con RLS (patrón 7a/8b/9a): la policy `user_can_record_match`
 * autoriza; un rechazo llega como 42501→'forbidden'. ONLINE (sin cola: el
 * post-partido se hace con red, no es la cola de eventos en vivo de 9b).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { TeamFormat } from '../lineups/types';
import {
  upsertEvaluationSchema,
  deleteEvaluationSchema,
  setPostMatchDoneSchema,
  upsertTeamEvaluationSchema,
  deleteTeamEvaluationSchema,
} from '../schemas/evaluation';

type DbClient = SupabaseClient<Database>;

// UUID de relleno para los NOT NULL que el BEFORE trigger reescribe (club_id/
// team_id los DERIVA del evento; created_by lo fuerza a auth.uid()).
const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';

// ─────────────────────────────────────────────────────────────────────────────
// READ — carga de la etapa post-partido
// ─────────────────────────────────────────────────────────────────────────────

/** Stats objetivas materializadas al cerrar (7.10, 9a). Contexto, no valoración. */
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
    teamColor: string;
    format: TeamFormat;
    type: string;
  };
  /** Estado de la sesión de captura (F7). El formulario solo se abre en 'closed'. */
  matchStatus: 'not_started' | 'live' | 'closed';
  /** F8 §3.5 — etapa de valoraciones completada (nodo "cerrado" del ciclo). */
  postMatchDone: boolean;
  /** Marcador final materializado al cerrar (7.10, 9a). null si no hay. */
  score: { own: number | null; against: number | null };
  players: PostMatchPlayer[];
  /** F8.3 — valoración COLECTIVA del equipo (una por partido). null si no hay. */
  teamEvaluation: { rating: number; comment: string | null } | null;
  /** Autoridad de valorar (RPC user_can_record_match) — para gatear la UI. */
  canRecord: boolean;
};

/**
 * Carga la etapa post-partido del evento `eventId`, acotado al club `clubId`.
 * La lista de jugadores a valorar es la PLANTILLA QUE PARTICIPÓ (filas de
 * `match_player_stats`, 7.10) ∪ los que ya tengan valoración (por si se reabrió y
 * editó). Las stats son CONTEXTO de solo lectura. Devuelve null si el evento no
 * existe / no es del club. `canRecord=false` cuando la RLS no autoriza (la UI lo
 * usa para deshabilitar, pero el gate REAL es la RLS de cada write).
 */
export async function getPostMatchFromClient(
  supabase: DbClient,
  clubId: string,
  eventId: string,
): Promise<PostMatchData | null> {
  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, type, title, opponent_name,
       teams!inner(name, color, format)`,
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
    teams: { name: string; color: string; format: TeamFormat };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS de evaluations / F7.1).
  const { data: canRecordRaw } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  const canRecord = canRecordRaw === true;

  // Estado + cierre de la etapa + marcador final.
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, post_match_done, goals_for, goals_against')
    .eq('event_id', eventId)
    .maybeSingle();
  const matchStatus =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ?? 'not_started';
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
  const playerIds = new Set<string>([...statsByPlayer.keys(), ...evalByPlayer.keys()]);
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

  // F8.3 — valoración COLECTIVA del equipo (una por partido).
  const { data: teamEvalRow } = await supabase
    .from('team_evaluations')
    .select('rating, comment')
    .eq('event_id', eventId)
    .maybeSingle();
  const teamEvaluation = teamEvalRow
    ? {
        rating: teamEvalRow.rating as number,
        comment: (teamEvalRow.comment as string | null) ?? null,
      }
    : null;

  return {
    event: {
      id: event.id,
      title: event.title,
      opponentName: event.opponent_name,
      teamName: event.teams.name,
      teamColor: event.teams.color,
      format: event.teams.format,
      type: event.type,
    },
    matchStatus,
    postMatchDone,
    score,
    players,
    teamEvaluation,
    canRecord,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITES — valoraciones (escritura directa RLS; la policy es el gate)
// ─────────────────────────────────────────────────────────────────────────────

export type PostMatchError =
  | 'forbidden'
  | 'rating_required'
  | 'empty'
  | 'mvp_taken'
  | 'invalid'
  | 'not_closed'
  | 'unauthenticated'
  | 'generic';

export type PostMatchOutcome = { ok: true } | { ok: false; error: PostMatchError };

function mapErr(message: string | undefined, code: string | undefined): PostMatchError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('rating_required_for_match')) return 'rating_required';
  if (message.includes('empty_evaluation')) return 'empty';
  if (message.includes('evaluations_one_mvp_per_event')) return 'mvp_taken';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  if (message.includes('event_not_a_match')) return 'invalid';
  return 'generic';
}

/**
 * Valoración individual (F8.2): upsert por (event_id, player_id) en `evaluations`.
 * MVP ÚNICO por evento (si este pasa a MVP, desmarca al anterior primero). Upsert
 * "a mano" (UPDATE de mutables; si 0 filas, INSERT) para NO tocar `created_by`
 * (inmutable por trigger: editor ≠ creador). La RLS impone quién puede valorar.
 */
export async function upsertEvaluationFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<PostMatchOutcome> {
  const parsed = upsertEvaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, player_id, rating, comment, is_mvp } = parsed.data;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  if (is_mvp) {
    const { error: clearErr } = await supabase
      .from('evaluations')
      .update({ is_mvp: false })
      .eq('event_id', event_id)
      .eq('is_mvp', true)
      .neq('player_id', player_id);
    if (clearErr) return { ok: false, error: mapErr(clearErr.message, clearErr.code) };
  }

  const { data: updated, error: updErr } = await supabase
    .from('evaluations')
    .update({ rating, comment, is_mvp })
    .eq('event_id', event_id)
    .eq('player_id', player_id)
    .select('player_id');
  if (updErr) return { ok: false, error: mapErr(updErr.message, updErr.code) };

  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase.from('evaluations').insert({
      event_id,
      player_id,
      club_id: PLACEHOLDER_UUID,
      team_id: PLACEHOLDER_UUID,
      event_type: 'match',
      created_by: user.id,
      rating,
      comment,
      is_mvp,
    });
    if (insErr) return { ok: false, error: mapErr(insErr.message, insErr.code) };
  }

  return { ok: true };
}

export async function deleteEvaluationFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<PostMatchOutcome> {
  const parsed = deleteEvaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, player_id } = parsed.data;

  const { error } = await supabase
    .from('evaluations')
    .delete()
    .eq('event_id', event_id)
    .eq('player_id', player_id);
  if (error) return { ok: false, error: mapErr(error.message, error.code) };
  return { ok: true };
}

/**
 * "Completar valoraciones" (F8 §3.5): marca match_state.post_match_done. Solo
 * sobre un partido FINALIZADO (status closed) → si no, 'not_closed'.
 */
export async function setPostMatchDoneFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<PostMatchOutcome> {
  const parsed = setPostMatchDoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, done } = parsed.data;

  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', event_id)
    .maybeSingle();
  if (stateRow?.status !== 'closed') return { ok: false, error: 'not_closed' };

  const { error } = await supabase
    .from('match_state')
    .update({ post_match_done: done })
    .eq('event_id', event_id);
  if (error) return { ok: false, error: mapErr(error.message, error.code) };
  return { ok: true };
}

/**
 * F8.3 — valoración COLECTIVA del equipo (tabla team_evaluations, una por
 * partido). Rating OBLIGATORIO. Upsert "a mano" como la individual (no tocar
 * created_by inmutable).
 */
export async function upsertTeamEvaluationFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<PostMatchOutcome> {
  const parsed = upsertTeamEvaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, rating, comment } = parsed.data;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: updated, error: updErr } = await supabase
    .from('team_evaluations')
    .update({ rating, comment })
    .eq('event_id', event_id)
    .select('event_id');
  if (updErr) return { ok: false, error: mapErr(updErr.message, updErr.code) };

  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase.from('team_evaluations').insert({
      event_id,
      club_id: PLACEHOLDER_UUID,
      team_id: PLACEHOLDER_UUID,
      created_by: user.id,
      rating,
      comment,
    });
    if (insErr) return { ok: false, error: mapErr(insErr.message, insErr.code) };
  }

  return { ok: true };
}

export async function deleteTeamEvaluationFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<PostMatchOutcome> {
  const parsed = deleteTeamEvaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  const { error } = await supabase
    .from('team_evaluations')
    .delete()
    .eq('event_id', event_id);
  if (error) return { ok: false, error: mapErr(error.message, error.code) };
  return { ok: true };
}
