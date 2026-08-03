/**
 * O2-9a — ESCRITURA del RELOJ y el ESTADO del directo (staff), framework-agnóstica.
 * Extraído de `apps/web/.../convocatorias/[eventId]/directo/actions.ts` (F7.7): la
 * web pasa a DELEGAR aquí (misma lógica → comportamiento idéntico) y solo añade su
 * `revalidatePath`; la app nativa lo llama directamente detrás del write-guard.
 *
 * Cubre SOLO el reloj/estado: iniciar partido, pausar/reanudar, terminar parte,
 * empezar siguiente periodo, ajuste manual, finalizar (+ consolidación 7.10) y
 * reabrir. NO registra eventos de partido (gol/tarjeta/cambio) — eso es 9b, con su
 * cola offline. El reloj/estado es escritura RLS DIRECTA y ONLINE (no encolable: son
 * filas autoritativas de match_state/match_periods).
 *
 * Toda la ARITMÉTICA del tiempo vive en el motor puro (`match/clock`): aquí solo se
 * orquesta la BD. El GATE autoritativo es la RLS (`user_can_record_match`) + los
 * triggers de 7.1; un rechazo llega como 42501 → `forbidden`. NO se reimplementa en
 * cliente.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import { isManageableMatchType } from '../events/types';
import {
  adjustClockPatch,
  buildNextPeriod,
  type ClockMutation,
  type ClockPeriod,
  clockSecondsAt,
  currentPeriod,
  endPeriodPatch,
  nextPeriodAfter,
  nextRegularPeriod,
  pauseClockPatch,
  type PeriodKind,
  resumeClockPatch,
} from './clock';
import { consolidateMatch, type ConsolidationEvent } from './consolidation';
import {
  adjustClockSchema,
  matchEventRefSchema,
  startNextPeriodSchema,
} from '../schemas/match-clock';

type DbClient = SupabaseClient<Database>;

export type ClockWriteError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'no_official_lineup'
  | 'already_closed'
  | 'not_live'
  | 'no_period'
  | 'period_ended'
  | 'period_running'
  | 'period_mismatch'
  | 'all_periods_played'
  | 'regulation_incomplete'
  | 'generic';

export type ClockWriteOutcome =
  | { ok: true }
  | { ok: false; error: ClockWriteError };

/** Réplica de `mapPgErr` de la web (42501 → forbidden). */
function mapClockPgErr(
  message: string | undefined,
  code: string | undefined,
): ClockWriteError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'invalid';
  if (message.includes('event_without_team')) return 'invalid';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  return 'generic';
}

function now() {
  const d = new Date();
  return { ms: d.getTime(), iso: d.toISOString() };
}

// Parche camelCase (motor) → fila snake_case de match_periods (solo campos presentes).
type PeriodUpdate = {
  base_offset_seconds?: number;
  accumulated_seconds?: number;
  running?: boolean;
  last_started_at?: string | null;
  ended?: boolean;
};
function toPeriodRow(m: ClockMutation): PeriodUpdate {
  const row: PeriodUpdate = {};
  if (m.baseOffsetSeconds !== undefined) row.base_offset_seconds = m.baseOffsetSeconds;
  if (m.accumulatedSeconds !== undefined) row.accumulated_seconds = m.accumulatedSeconds;
  if (m.running !== undefined) row.running = m.running;
  if (m.lastStartedAt !== undefined) row.last_started_at = m.lastStartedAt;
  if (m.ended !== undefined) row.ended = m.ended;
  return row;
}

type PeriodRow = ClockPeriod & { id: string };

async function loadPeriods(supabase: DbClient, eventId: string): Promise<PeriodRow[]> {
  const { data } = await supabase
    .from('match_periods')
    .select(
      'id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended',
    )
    .eq('event_id', eventId)
    .order('ordinal', { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    period: r.period as PeriodKind,
    ordinal: r.ordinal as number,
    baseOffsetSeconds: r.base_offset_seconds as number,
    accumulatedSeconds: r.accumulated_seconds as number,
    running: r.running as boolean,
    lastStartedAt: (r.last_started_at as string | null) ?? null,
    ended: r.ended as boolean,
  }));
}

async function loadStatus(
  supabase: DbClient,
  eventId: string,
): Promise<'not_started' | 'live' | 'closed' | null> {
  const { data } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', eventId)
    .maybeSingle();
  return (data?.status as 'not_started' | 'live' | 'closed' | undefined) ?? null;
}

/**
 * GATE de LECTURA para la UI (habilitar/deshabilitar controles): `user_can_record_match`
 * — el mismo helper RLS que autoriza las escrituras. No sustituye al gate real (RLS):
 * es solo para que la UI no ofrezca lo que el servidor rechazaría.
 */
export async function userCanRecordMatchFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  return data === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// startMatch — congela el once (match_starters), status→live, arranca 1ª parte.
// Idempotente: si ya está live no duplica periodos ni re-congela.
// ─────────────────────────────────────────────────────────────────────────────
export async function startMatchFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { ok: false, error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('id, club_id, team_id, type')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { ok: false, error: 'not_found' };
  if (!isManageableMatchType(ev.type as string)) return { ok: false, error: 'invalid' };
  if (ev.team_id == null) return { ok: false, error: 'invalid' };
  const clubId = ev.club_id as string;

  const { ms, iso } = now();

  const status = await loadStatus(supabase, event_id);
  if (status === 'closed') return { ok: false, error: 'already_closed' };

  if (status == null) {
    const { error } = await supabase.from('match_state').insert({
      event_id,
      club_id: clubId,
      status: 'live',
      started_at: iso,
      operator_profile_id: user.id,
      lock_heartbeat_at: iso,
    });
    if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  } else {
    const patch: {
      status: 'live';
      operator_profile_id: string;
      lock_heartbeat_at: string;
      started_at?: string;
    } = { status: 'live', operator_profile_id: user.id, lock_heartbeat_at: iso };
    if (status === 'not_started') patch.started_at = iso;
    const { error } = await supabase
      .from('match_state')
      .update(patch)
      .eq('event_id', event_id);
    if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  }

  // Congelar el once desde la alineación oficial (solo la primera vez).
  const { data: existingStarters } = await supabase
    .from('match_starters')
    .select('player_id')
    .eq('event_id', event_id)
    .limit(1);
  if ((existingStarters ?? []).length === 0) {
    const { data: official } = await supabase
      .from('lineups')
      .select('id')
      .eq('event_id', event_id)
      .eq('is_official', true)
      .maybeSingle();
    if (!official) return { ok: false, error: 'no_official_lineup' };

    const { data: positions } = await supabase
      .from('lineup_positions')
      .select('player_id, position_code')
      .eq('lineup_id', official.id as string)
      .eq('location', 'field');
    const starters = (positions ?? []).map((p) => ({
      event_id,
      player_id: p.player_id as string,
      position_code: (p.position_code as string | null) ?? null,
    }));
    if (starters.length > 0) {
      const { error } = await supabase.from('match_starters').insert(starters);
      if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
    }
  }

  // Arrancar la 1ª parte (solo si aún no hay periodos).
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) {
    const first = buildNextPeriod([], ms, iso);
    if (first) {
      const { error } = await supabase.from('match_periods').insert({
        event_id,
        period: first.period,
        ordinal: first.ordinal,
        base_offset_seconds: first.baseOffsetSeconds,
        accumulated_seconds: first.accumulatedSeconds,
        running: first.running,
        last_started_at: first.lastStartedAt,
        ended: first.ended,
      });
      if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// pauseClock — pausa el periodo en curso (pliega lo corrido). Idempotente.
// ─────────────────────────────────────────────────────────────────────────────
export async function pauseClockFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const running = periods.find((p) => p.running);
  if (!running) return { ok: true }; // ya estaba en pausa

  const { ms } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(pauseClockPatch(running, ms)))
    .eq('id', running.id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// resumeClock — reanuda el periodo en pausa (no terminado).
// ─────────────────────────────────────────────────────────────────────────────
export async function resumeClockFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { ok: false, error: 'no_period' };
  if (cur.running) return { ok: true }; // ya corría
  if (cur.ended) return { ok: false, error: 'period_ended' };

  const { iso } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(resumeClockPatch(iso)))
    .eq('id', cur.id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// endPeriod — termina el periodo en curso → descanso (o fin del tiempo jugado).
// ─────────────────────────────────────────────────────────────────────────────
export async function endPeriodFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { ok: false, error: 'no_period' };
  if (cur.ended) return { ok: true }; // ya terminado

  const { ms } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(endPeriodPatch(cur, ms)))
    .eq('id', cur.id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// startNextPeriod — empieza la 2ª parte / prórroga / penaltis (§6).
// ─────────────────────────────────────────────────────────────────────────────
export async function startNextPeriodFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = startNextPeriodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, period } = parsed.data;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.some((p) => p.running)) return { ok: false, error: 'period_running' };

  const next = nextPeriodAfter(periods);
  if (!next) return { ok: false, error: 'all_periods_played' };
  if (next.period !== period) return { ok: false, error: 'period_mismatch' };

  const { ms, iso } = now();
  const built = buildNextPeriod(periods, ms, iso);
  if (!built) return { ok: false, error: 'all_periods_played' };

  const { error } = await supabase.from('match_periods').insert({
    event_id,
    period: built.period,
    ordinal: built.ordinal,
    base_offset_seconds: built.baseOffsetSeconds,
    accumulated_seconds: built.accumulatedSeconds,
    running: built.running,
    last_started_at: built.lastStartedAt,
    ended: built.ended,
  });
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// adjustClock — ajuste manual ±segundos del periodo actual (§6). Nunca baja de 0.
// ─────────────────────────────────────────────────────────────────────────────
export async function adjustClockFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = adjustClockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, delta_seconds } = parsed.data;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { ok: false, error: 'no_period' };

  const { ms, iso } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(adjustClockPatch(cur, delta_seconds, ms, iso)))
    .eq('id', cur.id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// consolidateMatchAndPersistFromClient — F7.10: materializa match_player_stats +
// marcador final. REUSA el motor puro `consolidateMatch`. Delete+reinsert (§5.3).
// ─────────────────────────────────────────────────────────────────────────────
export async function consolidateMatchAndPersistFromClient(
  supabase: DbClient,
  eventId: string,
  closedBy: string,
): Promise<ClockWriteError | null> {
  const { data: ev } = await supabase
    .from('events')
    .select('club_id, team_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || ev.team_id == null) return 'invalid';
  const clubId = ev.club_id as string;
  const teamId = ev.team_id as string;

  const { data: starterRows } = await supabase
    .from('match_starters')
    .select('player_id')
    .eq('event_id', eventId);
  const starterIds = (starterRows ?? []).map((r) => r.player_id as string);

  const { data: evRows } = await supabase
    .from('match_events')
    .select('side, type, player_id, related_player_id, clock_seconds, metadata')
    .eq('event_id', eventId);
  const events: ConsolidationEvent[] = (evRows ?? []).map((r) => {
    const meta = (r.metadata as { outcome?: string; foul_kind?: string } | null) ?? null;
    return {
      side: r.side as 'own' | 'rival',
      type: r.type as string,
      playerId: (r.player_id as string | null) ?? null,
      relatedPlayerId: (r.related_player_id as string | null) ?? null,
      clockSeconds: r.clock_seconds as number,
      outcome: meta?.outcome ?? null,
      foulKind: meta?.foul_kind ?? null,
    };
  });

  const periods = await loadPeriods(supabase, eventId);
  const matchClockSeconds = clockSecondsAt(periods, now().ms);

  const { data: absRows } = await supabase
    .from('match_absences')
    .select('player_id')
    .eq('event_id', eventId);
  const absentIds = (absRows ?? []).map((r) => r.player_id as string);

  // rosterIds = participantes: titulares + propio con evento + entrados por sub.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  for (const id of starterIds) add(id);
  for (const e of events) {
    if (e.side !== 'own') continue;
    add(e.playerId);
    if (e.type === 'substitution') add(e.relatedPlayerId);
  }

  const { players, score, shootout } = consolidateMatch({
    starterIds,
    events,
    matchClockSeconds,
    absentIds,
    rosterIds: ordered,
  });

  const { error: delErr } = await supabase
    .from('match_player_stats')
    .delete()
    .eq('event_id', eventId);
  if (delErr) return mapClockPgErr(delErr.message, delErr.code);

  if (players.length > 0) {
    const rows = players.map((p) => ({
      event_id: eventId,
      player_id: p.playerId,
      club_id: clubId,
      team_id: teamId,
      started: p.started,
      minutes_played: p.minutesPlayed,
      goals: p.goals,
      assists: p.assists,
      yellow_cards: p.yellowCards,
      red_cards: p.redCards,
      shots: p.shots,
      fouls_committed: p.foulsCommitted,
      fouls_received: p.foulsReceived,
      penalties_scored: p.penaltiesScored,
      penalties_missed: p.penaltiesMissed,
    }));
    const { error: insErr } = await supabase.from('match_player_stats').insert(rows);
    if (insErr) return mapClockPgErr(insErr.message, insErr.code);
  }

  const { error: scoreErr } = await supabase
    .from('match_state')
    .update({
      goals_for: score.own,
      goals_against: score.rival,
      shootout_for: shootout ? shootout.own : null,
      shootout_against: shootout ? shootout.rival : null,
      closed_at: now().iso,
      closed_by: closedBy,
    })
    .eq('event_id', eventId);
  if (scoreErr) return mapClockPgErr(scoreErr.message, scoreErr.code);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// finishMatch — status→closed, para el reloj y CONSOLIDA (7.10). Idempotente.
// ─────────────────────────────────────────────────────────────────────────────
export async function finishMatchFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { ok: false, error: 'forbidden' };

  const status = await loadStatus(supabase, event_id);
  if (status === 'closed') return { ok: true }; // ya terminado (idempotente)
  if (status !== 'live') return { ok: false, error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (nextRegularPeriod(periods) !== null) return { ok: false, error: 'regulation_incomplete' };

  // Parar el reloj: terminar el periodo en curso si quedara sin terminar.
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (cur && !cur.ended) {
    const { ms } = now();
    const { error } = await supabase
      .from('match_periods')
      .update(toPeriodRow(endPeriodPatch(cur, ms)))
      .eq('id', cur.id);
    if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  }

  const { error } = await supabase
    .from('match_state')
    .update({ status: 'closed' })
    .eq('event_id', event_id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };

  const consolidateErr = await consolidateMatchAndPersistFromClient(supabase, event_id, user.id);
  if (consolidateErr) return { ok: false, error: consolidateErr };

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// reopenMatch — de 'closed' vuelve a 'live', +reopened_count, limpia sello cierre.
// ─────────────────────────────────────────────────────────────────────────────
export async function reopenMatchFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<ClockWriteOutcome> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id } = parsed.data;

  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, reopened_count')
    .eq('event_id', event_id)
    .maybeSingle();
  if (!stateRow) return { ok: false, error: 'not_found' };
  if (stateRow.status !== 'closed') return { ok: true }; // no estaba cerrado

  const { error } = await supabase
    .from('match_state')
    .update({
      status: 'live',
      reopened_count: ((stateRow.reopened_count as number | null) ?? 0) + 1,
      closed_at: null,
      closed_by: null,
    })
    .eq('event_id', event_id);
  if (error) return { ok: false, error: mapClockPgErr(error.message, error.code) };
  return { ok: true };
}
