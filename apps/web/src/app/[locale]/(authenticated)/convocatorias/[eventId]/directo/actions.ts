'use server';

/**
 * F7.7 — Server actions del reloj del partido en vivo.
 *
 * Spec 7.0 §3.2/§3.3/§6: "Iniciar partido" congela el once (match_starters),
 * pone match_state en 'live' y arranca la 1ª parte (match_periods). El resto de
 * acciones controlan el cronómetro recuperable: pausa/reanuda, fin de parte
 * (descanso), siguiente periodo (2ª parte / prórroga) y ajuste manual.
 *
 * Toda la ARITMÉTICA del tiempo vive en el motor puro de @misterfc/core
 * (match/clock); aquí solo orquestamos la BD. El gate autoritativo es la RLS
 * (user_can_record_match) + los triggers de 7.1; estos schemas validan la forma
 * de la entrada antes de tocar la BD.
 *
 * NO registra eventos de partido (gol/asistencia/tarjeta): eso es 7.3, que se
 * apoya en este reloj (clock_seconds = clockSecondsAt(periods, now)).
 */

import { revalidatePath } from 'next/cache';
import {
  addTimelineEventSchema,
  adjustClockPatch,
  adjustClockSchema,
  assignPlayersToFormation,
  buildNextPeriod,
  canRegisterSubstitution,
  changeFormationSchema,
  clockFieldsForMinute,
  clockSecondsAt,
  type ClockMutation,
  type ClockPeriod,
  consolidateMatch,
  type ConsolidationEvent,
  createSupabaseServerClient,
  currentPeriod,
  deleteMatchEventSchema,
  DEFAULT_REGIME,
  deriveExpelledPlayers,
  deriveSquad,
  endPeriodPatch,
  type FieldPlayerPos,
  type FieldSlot,
  formationsForFormat,
  getFormation,
  type Json,
  type LivePositions,
  matchEventRefSchema,
  moveLivePlayer,
  movePlayerSchema,
  nextPeriodAfter,
  nextRegularPeriod,
  isExpelled,
  isFieldEventType,
  pauseClockPatch,
  type PeriodKind,
  type PlayerEventType,
  playerEventClockFields,
  registerCornerSchema,
  registerFieldEventSchema,
  registerFoulSchema,
  registerPenaltySchema,
  registerPlayerEventSchema,
  registerRivalEventSchema,
  registerRivalPenaltySchema,
  registerShootoutKickSchema,
  registerSubstitutionSchema,
  resolveCardOutcome,
  type SubstitutionRegime,
  resumeClockPatch,
  setAbsenceSchema,
  setMatchNotesSchema,
  startNextPeriodSchema,
  type Sub,
  type TeamFormat,
  updateEventActorSchema,
  updateEventMinuteSchema,
  upsertRivalHighlightSchema,
  deleteRivalHighlightSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos y helpers
// ─────────────────────────────────────────────────────────────────────────────

type ActionError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'no_official_lineup'
  | 'already_closed'
  | 'not_live'
  | 'no_period'
  | 'period_running'
  | 'period_ended'
  | 'period_mismatch'
  | 'all_periods_played'
  | 'regulation_incomplete'
  | 'generic';

export type ClockActionState = {
  error?: ActionError;
  success?: boolean;
};

function mapPgErr(message: string | undefined, code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'invalid';
  if (message.includes('event_without_team')) return 'invalid';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  return 'generic';
}

function revalidate(eventId: string) {
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}/directo`,
    'page',
  );
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
}

type Supa = ReturnType<typeof createSupabaseServerClient>;

/** Parche camelCase → fila snake_case de match_periods (solo campos presentes). */
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

/** Carga los periodos del partido como proyección del motor (con id para update). */
async function loadPeriods(supabase: Supa, eventId: string): Promise<PeriodRow[]> {
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

/** Estado de la sesión (status) si existe. */
async function loadStatus(
  supabase: Supa,
  eventId: string,
): Promise<'not_started' | 'live' | 'closed' | null> {
  const { data } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', eventId)
    .maybeSingle();
  return (data?.status as 'not_started' | 'live' | 'closed' | undefined) ?? null;
}

function now() {
  const d = new Date();
  return { ms: d.getTime(), iso: d.toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// startMatch — "Iniciar partido" (§3.3): congela el once, status→live, arranca 1ª.
//
// Idempotente: si ya está live no duplica periodos ni re-congela; solo refresca
// el lock advisory (§5.5). Requiere alineación oficial (la fuente del once).
// ─────────────────────────────────────────────────────────────────────────────

export async function startMatch(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('id, club_id, team_id, type')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  if (ev.type !== 'match' && ev.type !== 'friendly') return { error: 'invalid' };
  if (ev.team_id == null) return { error: 'invalid' };
  const clubId = ev.club_id as string;

  const { ms, iso } = now();

  // 1. match_state — crear o transicionar a 'live'.
  const status = await loadStatus(supabase, event_id);
  if (status === 'closed') return { error: 'already_closed' };

  if (status == null) {
    const { error } = await supabase.from('match_state').insert({
      event_id,
      club_id: clubId, // el trigger lo deriva igualmente; lo pasamos por el NOT NULL.
      status: 'live',
      started_at: iso,
      operator_profile_id: user.id,
      lock_heartbeat_at: iso,
    });
    if (error) return { error: mapPgErr(error.message, error.code) };
  } else {
    // not_started → live (sella started_at si faltaba), o live → refresca lock.
    const patch: {
      status: 'live';
      operator_profile_id: string;
      lock_heartbeat_at: string;
      started_at?: string;
    } = {
      status: 'live',
      operator_profile_id: user.id,
      lock_heartbeat_at: iso,
    };
    if (status === 'not_started') patch.started_at = iso;
    const { error } = await supabase
      .from('match_state')
      .update(patch)
      .eq('event_id', event_id);
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  // 2. Congelar el once desde la alineación oficial (solo la primera vez).
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
    if (!official) return { error: 'no_official_lineup' };

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
      if (error) return { error: mapPgErr(error.message, error.code) };
    }
  }

  // 3. Arrancar la 1ª parte (solo si aún no hay periodos).
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
      if (error) return { error: mapPgErr(error.message, error.code) };
    }
  }

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// pauseClock — pausa el periodo en curso (pliega lo corrido). Idempotente.
// ─────────────────────────────────────────────────────────────────────────────

export async function pauseClock(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const running = periods.find((p) => p.running);
  if (!running) {
    revalidate(event_id);
    return { success: true }; // ya estaba en pausa
  }

  const { ms } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(pauseClockPatch(running, ms)))
    .eq('id', running.id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// resumeClock — reanuda el periodo en pausa (no terminado).
// ─────────────────────────────────────────────────────────────────────────────

export async function resumeClock(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { error: 'no_period' };
  if (cur.running) {
    revalidate(event_id);
    return { success: true }; // ya corría
  }
  // Un periodo TERMINADO no se reanuda: hay que empezar el siguiente (descanso).
  if (cur.ended) return { error: 'period_ended' };

  const { iso } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(resumeClockPatch(iso)))
    .eq('id', cur.id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// endPeriod — termina el periodo en curso → descanso (o fin del tiempo jugado).
// ─────────────────────────────────────────────────────────────────────────────

export async function endPeriod(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { error: 'no_period' };
  if (cur.ended) {
    revalidate(event_id);
    return { success: true }; // ya terminado
  }

  const { ms } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(endPeriodPatch(cur, ms)))
    .eq('id', cur.id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// startNextPeriod — empieza la 2ª parte / prórroga / penaltis (§6).
//
// Requiere que el periodo anterior esté terminado (descanso). El `period` del
// cliente debe coincidir con el siguiente del catálogo (guard anti doble-clic).
// ─────────────────────────────────────────────────────────────────────────────

export async function startNextPeriod(input: unknown): Promise<ClockActionState> {
  const parsed = startNextPeriodSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, period } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.some((p) => p.running)) return { error: 'period_running' };

  const next = nextPeriodAfter(periods);
  if (!next) return { error: 'all_periods_played' };
  if (next.period !== period) return { error: 'period_mismatch' };

  const { ms, iso } = now();
  const built = buildNextPeriod(periods, ms, iso);
  if (!built) return { error: 'all_periods_played' };

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
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.10 — Consolidación al cierre: materializa match_player_stats + marcador.
//
// REUSA el motor puro `consolidateMatch` (que a su vez compone 7.8/7.4b/7.7c):
// los mismos valores que la tabla en vivo, sin recalcular con lógica nueva. Hace
// delete+reinsert de la cara del partido (§5.3) → re-cerrar tras editar (línea de
// tiempo 7.9) sobrescribe consistentemente, sin filas obsoletas. Guarda el
// marcador final en match_state.goals_for/goals_against y la tanda (si la hubo)
// en shootout_for/against. Todo deriva de match_events/match_starters/
// match_periods → robusto y repetible.
// ─────────────────────────────────────────────────────────────────────────────

async function consolidateAndPersist(
  supabase: Supa,
  eventId: string,
  closedBy: string,
): Promise<ActionError | null> {
  const { data: ev } = await supabase
    .from('events')
    .select('club_id, team_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || ev.team_id == null) return 'invalid';
  const clubId = ev.club_id as string;
  const teamId = ev.team_id as string;

  // Once congelado + todos los eventos + reloj final + ausencias.
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

  // rosterIds = los que participaron: titulares + cualquier jugador propio con
  // evento + los que entraron por sustitución (orden estable: titulares primero).
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

  // Delete + reinsert de la cara del partido (consistente al re-cerrar, §5.3).
  const { error: delErr } = await supabase
    .from('match_player_stats')
    .delete()
    .eq('event_id', eventId);
  if (delErr) return mapPgErr(delErr.message, delErr.code);

  if (players.length > 0) {
    const rows = players.map((p) => ({
      event_id: eventId,
      player_id: p.playerId,
      club_id: clubId, // el trigger lo deriva; lo pasamos por el NOT NULL.
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
    if (insErr) return mapPgErr(insErr.message, insErr.code);
  }

  // Marcador final (y tanda si la hubo) en la cabecera de sesión.
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
  if (scoreErr) return mapPgErr(scoreErr.message, scoreErr.code);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// finishMatch — "Finalizar partido" (F7.7b): marca el partido como TERMINADO
// (match_state.status → 'closed'), para el reloj y CONSOLIDA (7.10).
//
// Requiere que el tiempo reglamentario esté cubierto (2ª parte jugada): si aún
// queda una parte regular por jugar → 'regulation_incomplete'. Si quedara un
// periodo en curso (sin terminar), lo termina antes de cerrar (pliega lo corrido)
// para dejar `clock_seconds` consistente. Idempotente: si ya está cerrado, no
// hace nada. Al cerrar, materializa match_player_stats + marcador final (7.10,
// `consolidateAndPersist`). El reabrir (`reopenMatch`) vuelve a editable y el
// re-cierre re-materializa (delete+reinsert).
// ─────────────────────────────────────────────────────────────────────────────

export async function finishMatch(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const status = await loadStatus(supabase, event_id);
  if (status === 'closed') {
    revalidate(event_id);
    return { success: true }; // ya terminado (idempotente)
  }
  if (status !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  // No se finaliza con una parte regular aún pendiente (antes de la 2ª parte).
  if (nextRegularPeriod(periods) !== null) return { error: 'regulation_incomplete' };

  // Parar el reloj: terminar el periodo en curso si quedara sin terminar (pliega
  // lo corrido). Tras esto, canFinishMatch ya se cumple por construcción.
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (cur && !cur.ended) {
    const { ms } = now();
    const { error } = await supabase
      .from('match_periods')
      .update(toPeriodRow(endPeriodPatch(cur, ms)))
      .eq('id', cur.id);
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  const { error } = await supabase
    .from('match_state')
    .update({ status: 'closed' })
    .eq('event_id', event_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  // F7.10 — consolidar al cerrar (stats por jugador + marcador final).
  const consolidateErr = await consolidateAndPersist(supabase, event_id, user.id);
  if (consolidateErr) return { error: consolidateErr };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// reopenMatch — "Reabrir partido" (F7.10): de 'closed' vuelve a 'live' (editable
// de nuevo: captura en vivo + línea de tiempo 7.9), incrementa reopened_count y
// limpia el sello de cierre. La consolidación previa queda; al volver a finalizar
// se RE-MATERIALIZA (delete+reinsert). UI con confirmación en dos pasos.
// ─────────────────────────────────────────────────────────────────────────────

export async function reopenMatch(input: unknown): Promise<ClockActionState> {
  const parsed = matchEventRefSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, reopened_count')
    .eq('event_id', event_id)
    .maybeSingle();
  if (!stateRow) return { error: 'not_found' };
  if (stateRow.status !== 'closed') {
    revalidate(event_id);
    return { success: true }; // no estaba cerrado (idempotente)
  }

  const { error } = await supabase
    .from('match_state')
    .update({
      status: 'live',
      reopened_count: ((stateRow.reopened_count as number | null) ?? 0) + 1,
      closed_at: null,
      closed_by: null,
    })
    .eq('event_id', event_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// adjustClock — ajuste manual ±segundos del periodo actual (§6). Nunca baja de 0.
// ─────────────────────────────────────────────────────────────────────────────

export async function adjustClock(input: unknown): Promise<ClockActionState> {
  const parsed = adjustClockSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, delta_seconds } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  const cur = currentPeriod(periods) as PeriodRow | null;
  if (!cur) return { error: 'no_period' };

  const { ms, iso } = now();
  const { error } = await supabase
    .from('match_periods')
    .update(toPeriodRow(adjustClockPatch(cur, delta_seconds, ms, iso)))
    .eq('id', cur.id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerPlayerEvent — F7.3: registra un evento SOBRE UN JUGADOR propio.
//
// El cliente solo manda (id, type, player_id): `side='own'`, `clock_seconds`,
// `period` y `display_minute` los DERIVA el servidor del reloj de 7.7 (motor
// de @misterfc/core), no el cliente → fiable e inmune al skew del dispositivo.
// El `id` lo genera el cliente (UUID) → reintento idempotente con upsert/ignore
// (§10). Asistencia: enlaza al ÚLTIMO gol propio vía metadata.goal_event_id
// (§7.3); si no hay gol previo, se registra sin enlace (no se bloquea).
//
// Expulsión (regla F7.3, spec §3.4 bis): la expulsión es un ESTADO DERIVADO
// (1 roja O 2 amarillas), NO una fila de roja aparte. Un jugador ya expulsado no
// recibe más eventos (bloquea la 2ª roja y cualquier otro). La 2ª amarilla se
// registra como una amarilla más. La decisión la calcula el motor puro
// `resolveCardOutcome`. De cara a 7.8 (minutos) y 7.5 (volver), la "salida" se
// lee del estado derivado, no de una roja explícita.
// Editar/borrar es la línea de tiempo (7.9); aquí solo se registra.
// ─────────────────────────────────────────────────────────────────────────────

type EventActionError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'not_live'
  | 'no_period'
  | 'player_not_in_team'
  | 'player_expelled'
  | 'player_not_on_field'
  | 'player_not_eligible'
  | 'formation_invalid'
  | 'sub_limit_reached'
  | 'not_editable'
  | 'generic';

export type RegisterEventState = {
  error?: EventActionError;
  success?: boolean;
  eventRowId?: string;
  /** El jugador queda expulsado tras este evento (1 roja O 2 amarillas). */
  expelled?: boolean;
};

function mapEventErr(
  message: string | undefined,
  code: string | undefined,
): EventActionError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('player_not_in_team_at_event')) return 'player_not_in_team';
  if (message.includes('event_not_match')) return 'invalid';
  if (message.includes('event_without_team')) return 'invalid';
  return 'generic';
}

export async function registerPlayerEvent(
  input: unknown,
): Promise<RegisterEventState> {
  const parsed = registerPlayerEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, type, player_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // club_id y created_by los DERIVA/forza el trigger de 7.1, pero el tipo Insert
  // los exige: created_by = usuario; club_id del evento.
  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  // Solo con el partido EN VIVO (necesitamos un reloj corriendo/parado).
  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  // Historial de tarjetas/eventos propios de ESE jugador → regla de expulsión.
  const existingTypes = await loadPlayerOwnEventTypes(supabase, event_id, player_id);
  const outcome = resolveCardOutcome(existingTypes, type as PlayerEventType);
  if (outcome.kind === 'blocked') return { error: outcome.reason };

  // clock_seconds / period / display_minute autoritativos (hora del servidor).
  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  // Asistencia → enlaza al último gol propio registrado (§7.3).
  let metadata: { goal_event_id?: string } = {};
  if (type === 'assist') {
    const { data: lastGoal } = await supabase
      .from('match_events')
      .select('id')
      .eq('event_id', event_id)
      .eq('side', 'own')
      .eq('type', 'goal')
      .order('clock_seconds', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastGoal?.id) metadata = { goal_event_id: lastGoal.id as string };
  }

  // upsert con ignoreDuplicates: reintentar con el mismo id no duplica (§10).
  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId, // el trigger lo deriva; lo pasamos por el NOT NULL.
      created_by: user.id, // idem (el trigger fuerza auth.uid()).
      side: 'own',
      type,
      player_id,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  // Expulsado = estado DERIVADO tras añadir este evento (1 roja O 2 amarillas).
  const expelled = isExpelled([...existingTypes, type]);

  revalidate(event_id);
  return { success: true, eventRowId: id, expelled };
}

/** Tipos de eventos PROPIOS (side='own') ya registrados de un jugador. */
async function loadPlayerOwnEventTypes(
  supabase: Supa,
  eventId: string,
  playerId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('match_events')
    .select('type')
    .eq('event_id', eventId)
    .eq('side', 'own')
    .eq('player_id', playerId);
  return (data ?? []).map((r) => r.type as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.5 — estado vivo del once (campo/banquillo) para validar la sustitución en
// el servidor. Carga lo persistido y deriva con el motor puro `deriveSquad`.
// ─────────────────────────────────────────────────────────────────────────────

async function loadLiveSquad(supabase: Supa, eventId: string) {
  // Huecos del campo + suplentes: de la alineación OFICIAL.
  const { data: official } = await supabase
    .from('lineups')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();
  const slots: FieldSlot[] = [];
  const bench: string[] = [];
  if (official?.id) {
    const { data: positions } = await supabase
      .from('lineup_positions')
      .select('player_id, position_code, x_pct, y_pct, location')
      .eq('lineup_id', official.id as string);
    for (const p of positions ?? []) {
      if (p.location === 'field') {
        slots.push({
          playerId: p.player_id as string,
          positionCode: (p.position_code as string | null) ?? null,
          xPct: p.x_pct == null ? null : Number(p.x_pct),
          yPct: p.y_pct == null ? null : Number(p.y_pct),
        });
      } else if (p.location === 'bench') {
        bench.push(p.player_id as string);
      }
    }
  }

  // Sustituciones (orden cronológico) + tarjetas (expulsión) + ausencias.
  const { data: ownEvents } = await supabase
    .from('match_events')
    .select('type, player_id, related_player_id, clock_seconds')
    .eq('event_id', eventId)
    .eq('side', 'own')
    .order('clock_seconds', { ascending: true });
  const subs: Sub[] = [];
  const cardTypesByPlayer: { type: string; playerId: string | null }[] = [];
  for (const e of ownEvents ?? []) {
    if (e.type === 'substitution' && e.player_id && e.related_player_id) {
      subs.push({ out: e.player_id as string, in: e.related_player_id as string });
    } else if (e.type === 'yellow_card' || e.type === 'red_card') {
      cardTypesByPlayer.push({ type: e.type as string, playerId: e.player_id as string | null });
    }
  }
  const expelled = deriveExpelledPlayers(cardTypesByPlayer);

  const { data: absRows } = await supabase
    .from('match_absences')
    .select('player_id')
    .eq('event_id', eventId);
  const absent = (absRows ?? []).map((r) => r.player_id as string);

  // F7.6c — la elegibilidad del que ENTRA (reentrada) depende del RÉGIMEN de
  // cambios de (categoría, división) del equipo.
  const regime = await loadRegime(supabase, eventId);

  return deriveSquad({
    slots,
    bench,
    subs,
    expelled,
    absent,
    allowReentry: regime.allowReentry,
  });
}

/**
 * F7.6c — régimen de cambios del equipo del partido, resuelto desde
 * (categories.kind, teams.division) contra la tabla `substitution_regimes`.
 * Si no hay fila (p.ej. categoría adulta sin división cargada) → DEFAULT_REGIME.
 */
async function loadRegime(supabase: Supa, eventId: string): Promise<SubstitutionRegime> {
  const { data } = await supabase
    .from('events')
    .select('teams!inner(division, categories!inner(kind))')
    .eq('id', eventId)
    .maybeSingle();
  type Shape = { teams: { division: string | null; categories: { kind: string | null } } } | null;
  const team = (data as unknown as Shape)?.teams;
  const kind = team?.categories?.kind ?? null;
  const division = team?.division ?? null;
  if (!kind || !division) return DEFAULT_REGIME;

  const { data: row } = await supabase
    .from('substitution_regimes')
    .select('regime_type, max_subs, allow_reentry')
    .eq('category_kind', kind)
    .eq('division', division)
    .maybeSingle();
  if (!row) return DEFAULT_REGIME;
  return {
    type: row.regime_type as SubstitutionRegime['type'],
    maxSubs: (row.max_subs as number | null) ?? null,
    allowReentry: row.allow_reentry as boolean,
  };
}

/** Nº de sustituciones ya registradas del equipo (desde match_events, §7.6c). */
async function countSubstitutions(supabase: Supa, eventId: string): Promise<number> {
  const { count } = await supabase
    .from('match_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('side', 'own')
    .eq('type', 'substitution');
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// registerSubstitution — F7.5: SALE player_out (en campo) ENTRA player_in
// (suplente elegible). Persiste un match_event type='substitution'
// (player_id=sale, related_player_id=entra) con el reloj de 7.7.
// ─────────────────────────────────────────────────────────────────────────────

export async function registerSubstitution(
  input: unknown,
): Promise<RegisterEventState> {
  const parsed = registerSubstitutionSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, player_out_id, player_in_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  // F7.6c — régimen LIMITADO: tope de sustituciones (cuenta desde match_events,
  // no estado efímero). En corrido no hay tope. La reentrada del que entra ya la
  // filtra loadLiveSquad (régimen.allowReentry vía deriveSquad).
  const regime = await loadRegime(supabase, event_id);
  const subsSoFar = await countSubstitutions(supabase, event_id);
  if (!canRegisterSubstitution(regime, subsSoFar)) return { error: 'sub_limit_reached' };

  // El que SALE debe estar en campo; el que ENTRA, elegible (suplente no
  // expulsado/ausente/ya-entrado). Derivado de lo persistido (autoritativo).
  const squad = await loadLiveSquad(supabase, event_id);
  if (!squad.onFieldIds.includes(player_out_id)) return { error: 'player_not_on_field' };
  if (!squad.eligibleInIds.includes(player_in_id)) return { error: 'player_not_eligible' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type: 'substitution',
      player_id: player_out_id,
      related_player_id: player_in_id,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  // F7.6b — continuidad táctica: el que ENTRA hereda la posición VIVA del que
  // sale. NO se transfiere aquí: `deriveSquad` lo resuelve por la cadena de
  // ocupantes del hueco (el que entra hereda la posición del que salió), tanto
  // en optimista como al hidratar. Mantener una sola lógica evita divergencias.

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// setPlayerAbsent — F7.5: "quitar al que no viene". Marca/desmarca a un
// convocado como AUSENTE para este partido (match_absences). Reversible.
// ─────────────────────────────────────────────────────────────────────────────

export async function setPlayerAbsent(input: unknown): Promise<RegisterEventState> {
  const parsed = setAbsenceSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, absent } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // No exige partido en vivo: una baja de última hora puede marcarse antes de
  // iniciar. RLS (user_can_record_match) + el trigger validan permiso y roster.
  if (absent) {
    const { error } = await supabase
      .from('match_absences')
      .upsert({ event_id, player_id }, { onConflict: 'event_id,player_id', ignoreDuplicates: true });
    if (error) return { error: mapEventErr(error.message, error.code) };
  } else {
    const { error } = await supabase
      .from('match_absences')
      .delete()
      .eq('event_id', event_id)
      .eq('player_id', player_id);
    if (error) return { error: mapEventErr(error.message, error.code) };
  }

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerFieldEvent — F7.4: evento SOBRE EL CÉSPED (córner, falta, fuera de
// juego, tiro). Mismo patrón que 7.3 pero por UBICACIÓN (x_pct/y_pct, 0–100,
// equipo atacando hacia arriba §3.4) y SIN jugador. `side='own'`, clock/period/
// display_minute derivados del reloj de 7.7. Sin tarjetas ni enlace de asistencia.
// ─────────────────────────────────────────────────────────────────────────────

export async function registerFieldEvent(
  input: unknown,
): Promise<RegisterEventState> {
  const parsed = registerFieldEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, type, x_pct, y_pct } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type,
      x_pct,
      y_pct,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerRivalEvent — F7.6: evento del RIVAL. El rival no tiene roster (§3.4):
// se registra por DORSAL (1–99) + nota libre opcional, `side='rival'`, SIN
// jugador. Tipos aplicables: gol, amarilla, roja, falta, córner, fuera de juego,
// tiro. Coordenadas OPCIONALES y solo en tipos de campo (córner/falta/fuera de
// juego/tiro). clock/period/display_minute derivados del reloj de 7.7. Las
// tarjetas/expulsión del rival son informativas (no hay squad rival que gestionar).
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRivalEvent(
  input: unknown,
): Promise<RegisterEventState> {
  const parsed = registerRivalEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, type, rival_dorsal, note, x_pct, y_pct } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  // Coordenadas solo válidas en tipos de campo (el CHECK de 7.1 lo impone): para
  // gol/amarilla/roja van NULL aunque lleguen (defensivo).
  const isField = isFieldEventType(type);
  const xPct = isField && x_pct !== undefined ? x_pct : null;
  const yPct = isField && y_pct !== undefined ? y_pct : null;

  const trimmed = note?.trim();
  const metadata = trimmed ? { note: trimmed } : {};

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'rival',
      type,
      rival_dorsal,
      x_pct: xPct,
      y_pct: yPct,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.4b — Falta detallada (sobre jugador + ubicación) y córner con bando.
//   registerFoul   — falta propia ('committed', player=comete) o falta rival
//                    ('received', player=recibe), con x/y. side='own'.
//   registerCorner — córner a favor/en contra (sin jugador ni coords). side='own'.
// El bando va en metadata (foul_kind / corner_side); el tipo de match_events
// sigue siendo 'foul'/'corner' (no hace falta migrar). clock_seconds/period/
// display_minute los deriva el servidor.
// ─────────────────────────────────────────────────────────────────────────────

export async function registerFoul(input: unknown): Promise<RegisterEventState> {
  const parsed = registerFoulSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, player_id, kind, x_pct, y_pct } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type: 'foul',
      player_id,
      x_pct,
      y_pct,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { foul_kind: kind },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

export async function registerCorner(input: unknown): Promise<RegisterEventState> {
  const parsed = registerCornerSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, corner_side } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type: 'corner',
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { corner_side },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.7c — Penaltis. Tres acciones que comparten el patrón de inserción:
//   registerPenalty       — penalti propio durante el partido (sobre jugador).
//   registerRivalPenalty  — penalti del rival durante el partido (por dorsal).
//   registerShootoutKick   — lanzamiento de la TANDA (propio o rival).
// El resultado va en metadata.outcome. side/clock_seconds/period/display_minute
// los deriva el servidor (reloj de 7.7). Un penalti marcado cuenta como gol vía
// el motor puro (isMatchGoal / countPlayerEvents); NO se inserta un goal aparte.
// La tanda no suma minutos ni goles del partido (tipo aparte).
// ─────────────────────────────────────────────────────────────────────────────

export async function registerPenalty(input: unknown): Promise<RegisterEventState> {
  const parsed = registerPenaltySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, player_id, outcome } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  // Un jugador ya expulsado no puede lanzar (coherente con la regla de 7.3).
  const existingTypes = await loadPlayerOwnEventTypes(supabase, event_id, player_id);
  if (isExpelled(existingTypes)) return { error: 'player_expelled' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type: 'penalty',
      player_id,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { outcome },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

export async function registerRivalPenalty(input: unknown): Promise<RegisterEventState> {
  const parsed = registerRivalPenaltySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, rival_dorsal, outcome } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'rival',
      type: 'penalty',
      rival_dorsal,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { outcome },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

export async function registerShootoutKick(input: unknown): Promise<RegisterEventState> {
  const parsed = registerShootoutKickSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, side, player_id, rival_dorsal, outcome } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };
  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { ms } = now();
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, ms);

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side,
      type: 'shootout_penalty',
      player_id: side === 'own' ? (player_id ?? null) : null,
      rival_dorsal: side === 'rival' ? (rival_dorsal ?? null) : null,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { outcome },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.9 — Línea de tiempo EDITABLE. Cuatro operaciones que mutan `match_events`;
// minutos (7.8), marcador/penaltis (7.7c), contadores (7.4b) y expulsiones (7.3)
// se REDERIVAN de los eventos resultantes — NO hay estado paralelo, así que tras
// cada edición basta revalidar para que la pantalla recalcule todo y sobreviva a
// F5. Accesible EN VIVO y TRAS finalizar (status 'live' o 'closed'); no antes de
// iniciar (no hay reloj). El gate autoritativo sigue siendo la RLS
// (user_can_record_match) + los triggers de 7.1; aquí validamos forma + coherencia.
//
// "Cambiar el minuto" recalcula clock_seconds/period del MINUTO elegido con el
// motor del reloj (clockFieldsForMinute), inverso de display_minute. La validación
// de estados imposibles (findTimelineIssues) AVISA en la UI sin bloquear (spec 7.9).
// ─────────────────────────────────────────────────────────────────────────────

/** Estado que permite editar la línea de tiempo: en vivo o ya finalizado. */
async function loadEditableStatus(
  supabase: Supa,
  eventId: string,
): Promise<'live' | 'closed' | null> {
  const status = await loadStatus(supabase, eventId);
  return status === 'live' || status === 'closed' ? status : null;
}

// deleteMatchEvent — borra un evento de la línea de tiempo (por su id de cliente).
export async function deleteMatchEvent(input: unknown): Promise<RegisterEventState> {
  const parsed = deleteMatchEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const { error } = await supabase
    .from('match_events')
    .delete()
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// updateMatchEventMinute — reancla un evento a otro MINUTO (recalcula el reloj).
export async function updateMatchEventMinute(input: unknown): Promise<RegisterEventState> {
  const parsed = updateEventMinuteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, display_minute } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  // clock_seconds/period del minuto elegido, coherentes con el catálogo del reloj.
  const { clockSeconds, period, displayMinute } = clockFieldsForMinute(periods, display_minute);

  const { error } = await supabase
    .from('match_events')
    .update({
      clock_seconds: clockSeconds,
      period,
      display_minute: displayMinute,
    })
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// updateMatchEventActor — cambia el jugador propio / dorsal rival / (sub) los
// jugadores implicados. Solo aplica los campos coherentes con el side/type de la
// fila (no rompe el CHECK actor_by_side ni related_only_sub).
export async function updateMatchEventActor(input: unknown): Promise<RegisterEventState> {
  const parsed = updateEventActorSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, player_id, related_player_id, rival_dorsal } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const { data: row } = await supabase
    .from('match_events')
    .select('side, type')
    .eq('event_id', event_id)
    .eq('id', id)
    .maybeSingle();
  if (!row) return { error: 'not_found' };

  const patch: {
    player_id?: string;
    related_player_id?: string;
    rival_dorsal?: number;
  } = {};
  if (row.side === 'own') {
    if (player_id) patch.player_id = player_id;
    // El segundo jugador (entra) solo en sustituciones (related_only_sub).
    if (row.type === 'substitution' && related_player_id) {
      patch.related_player_id = related_player_id;
    }
  } else if (rival_dorsal != null) {
    patch.rival_dorsal = rival_dorsal;
  }
  if (Object.keys(patch).length === 0) return { error: 'invalid' };

  const { error } = await supabase
    .from('match_events')
    .update(patch)
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// addMatchEvent — ALTA de un evento olvidado en un minuto dado. Reusa el mismo
// modelo que las register* (mismo type, mismo metadata) pero con clock derivado
// del MINUTO elegido (no de "ahora"). Las sustituciones, cambios de formación y la
// tanda tienen su propia UI/derivación y no se dan de alta aquí.
export async function addMatchEvent(input: unknown): Promise<RegisterEventState> {
  const parsed = addTimelineEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const {
    event_id,
    id,
    side,
    type,
    display_minute,
    player_id,
    rival_dorsal,
    outcome,
    foul_kind,
    corner_side,
    x_pct,
    y_pct,
    note,
  } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  const { clockSeconds, period, displayMinute } = clockFieldsForMinute(periods, display_minute);

  // Falta y córner SIEMPRE son de nuestro panel (side='own' con su bando, §7.4b).
  const effectiveSide: 'own' | 'rival' =
    type === 'foul' || type === 'corner' ? 'own' : side;

  // Actor coherente con el bando. offside/shot/corner propios van por ubicación
  // (sin jugador); el resto de tipos propios llevan jugador.
  const ownByLocation = type === 'offside' || type === 'shot' || type === 'corner';
  const finalPlayerId =
    effectiveSide === 'own' && !ownByLocation ? (player_id ?? null) : null;
  const finalDorsal = effectiveSide === 'rival' ? (rival_dorsal ?? null) : null;

  // Coordenadas solo en tipos de campo (foul/offside/shot); el córner no lleva.
  const isFieldCoords = type === 'foul' || type === 'offside' || type === 'shot';
  const xPct = isFieldCoords && x_pct !== undefined ? x_pct : null;
  const yPct = isFieldCoords && y_pct !== undefined ? y_pct : null;

  const metadata: {
    outcome?: string;
    foul_kind?: string;
    corner_side?: string;
    note?: string;
  } = {};
  if (type === 'penalty' && outcome) metadata.outcome = outcome;
  if (type === 'foul' && foul_kind) metadata.foul_kind = foul_kind;
  if (type === 'corner' && corner_side) metadata.corner_side = corner_side;
  const trimmed = note?.trim();
  if (effectiveSide === 'rival' && trimmed) metadata.note = trimmed;

  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: effectiveSide,
      type,
      player_id: finalPlayerId,
      rival_dorsal: finalDorsal,
      x_pct: xPct,
      y_pct: yPct,
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.6b — Táctica en directo (solo nuestro equipo): mover jugadores + cambiar
// formación. El estado vivo (formación + posiciones) se guarda en match_state
// (live_formation_code/live_positions), SIN tocar match_starters ni la
// alineación oficial. Persiste e hidrata al recargar. deriveSquad sigue
// decidiendo QUIÉN está en el campo (subs/expulsiones/ausencias).
// ─────────────────────────────────────────────────────────────────────────────

type LiveTactics = {
  liveFormationCode: string | null;
  livePositions: LivePositions;
};

/** Carga el estado táctico vivo de match_state (vacío si aún no hay fila). */
async function loadLiveTactics(supabase: Supa, eventId: string): Promise<LiveTactics> {
  const { data } = await supabase
    .from('match_state')
    .select('live_formation_code, live_positions')
    .eq('event_id', eventId)
    .maybeSingle();
  return {
    liveFormationCode: (data?.live_formation_code as string | null) ?? null,
    livePositions: (data?.live_positions as LivePositions | null) ?? {},
  };
}

/** Modalidad del equipo del partido (para validar la formación del catálogo). */
async function loadTeamFormat(
  supabase: Supa,
  eventId: string,
): Promise<TeamFormat | null> {
  const { data } = await supabase
    .from('events')
    .select('teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  type Shape = { teams: { format: TeamFormat } } | null;
  return (data as unknown as Shape)?.teams?.format ?? null;
}

export async function movePlayer(input: unknown): Promise<RegisterEventState> {
  const parsed = movePlayerSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, x_pct, y_pct } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  // Solo se mueve a quien está EN EL CAMPO (derivado de lo persistido).
  const squad = await loadLiveSquad(supabase, event_id);
  if (!squad.onFieldIds.includes(player_id)) return { error: 'player_not_on_field' };

  const tactics = await loadLiveTactics(supabase, event_id);
  const nextPositions = moveLivePlayer(tactics.livePositions, player_id, x_pct, y_pct);

  const { error } = await supabase
    .from('match_state')
    .update({ live_positions: nextPositions as unknown as Json })
    .eq('event_id', event_id);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

export async function changeFormation(input: unknown): Promise<RegisterEventState> {
  const parsed = changeFormationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, id, formation_code } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', event_id)
    .maybeSingle();
  if (!ev) return { error: 'not_found' };
  const clubId = ev.club_id as string;

  if ((await loadStatus(supabase, event_id)) !== 'live') return { error: 'not_live' };

  // La formación debe existir en el catálogo de F6 Y ser de la modalidad del
  // equipo (no metemos una F11 en un equipo F7).
  const format = await loadTeamFormat(supabase, event_id);
  const formation = getFormation(formation_code);
  if (!format || !formation || formation.format !== format) {
    return { error: 'formation_invalid' };
  }
  if (!formationsForFormat(format).some((f) => f.code === formation_code)) {
    return { error: 'formation_invalid' };
  }

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { error: 'no_period' };

  // Recoloca a los que están EN EL CAMPO en los slots de la nueva formación,
  // partiendo de su posición ACTUAL (viva si la habían movido, si no la oficial).
  const squad = await loadLiveSquad(supabase, event_id);
  const tactics = await loadLiveTactics(supabase, event_id);
  const current: FieldPlayerPos[] = squad.onField.map((p) => {
    const ov = tactics.livePositions[p.playerId];
    return {
      playerId: p.playerId,
      xPct: ov?.xPct ?? p.xPct ?? 50,
      yPct: ov?.yPct ?? p.yPct ?? 50,
    };
  });
  const assigned = assignPlayersToFormation(current, formation);
  const nextPositions: LivePositions = { ...tactics.livePositions, ...assigned };

  // `from` = formación EN JUEGO antes del cambio: la viva, o la oficial de F6.
  let fromCode = tactics.liveFormationCode;
  if (!fromCode) {
    const { data: official } = await supabase
      .from('lineups')
      .select('formation_code')
      .eq('event_id', event_id)
      .eq('is_official', true)
      .maybeSingle();
    fromCode = (official?.formation_code as string | null) ?? null;
  }
  if (fromCode === formation_code) {
    // Sin cambio real: no registramos un evento vacío.
    revalidate(event_id);
    return { success: true };
  }

  // Materializa la formación/posiciones vivas (para pintar el campo al hidratar).
  const { error: stateErr } = await supabase
    .from('match_state')
    .update({
      live_formation_code: formation_code,
      live_positions: nextPositions as unknown as Json,
    })
    .eq('event_id', event_id);
  if (stateErr) return { error: mapEventErr(stateErr.message, stateErr.code) };

  // FUENTE ÚNICA del histórico: el cambio de táctica es un match_event de tipo
  // 'formation_change' (evento de equipo, sin jugador), con metadata {from,to}.
  // id de cliente → reintento idempotente (§10).
  const { clockSeconds, period, displayMinute } = playerEventClockFields(periods, now().ms);
  const { error } = await supabase.from('match_events').upsert(
    {
      id,
      event_id,
      club_id: clubId,
      created_by: user.id,
      side: 'own',
      type: 'formation_change',
      period,
      clock_seconds: clockSeconds,
      display_minute: displayMinute,
      metadata: { from: fromCode, to: formation_code },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true, eventRowId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.11 — Rivales destacados + notas del partido (solo de ESTE partido).
//
// Rivales destacados: marcar un dorsal rival (1–99) con una nota (rápido, duro,
// peligroso…). Añadir/editar = upsert por (event_id, dorsal); borrar por dorsal.
// Se puede destacar cualquier dorsal (no hace falta que tenga eventos).
// Notas del partido: texto libre en match_state.post_match_notes ('' → null).
//
// Disponibles EN VIVO y TRAS finalizar (status 'live' o 'closed'); el gate
// autoritativo es la RLS (user_can_record_match) + el trigger del evento. Persiste
// e hidrata → sobrevive a F5. No tocan match_player_stats ni el marcador.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertRivalHighlight(input: unknown): Promise<RegisterEventState> {
  const parsed = upsertRivalHighlightSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, dorsal, note } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const { error } = await supabase
    .from('match_rival_highlights')
    .upsert({ event_id, dorsal, note }, { onConflict: 'event_id,dorsal' });
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

export async function deleteRivalHighlight(input: unknown): Promise<RegisterEventState> {
  const parsed = deleteRivalHighlightSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, dorsal } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const { error } = await supabase
    .from('match_rival_highlights')
    .delete()
    .eq('event_id', event_id)
    .eq('dorsal', dorsal);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

export async function setMatchNotes(input: unknown): Promise<RegisterEventState> {
  const parsed = setMatchNotesSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, notes } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if ((await loadEditableStatus(supabase, event_id)) == null) return { error: 'not_editable' };

  const trimmed = notes.trim();
  const { error } = await supabase
    .from('match_state')
    .update({ post_match_notes: trimmed.length > 0 ? trimmed : null })
    .eq('event_id', event_id);
  if (error) return { error: mapEventErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}
