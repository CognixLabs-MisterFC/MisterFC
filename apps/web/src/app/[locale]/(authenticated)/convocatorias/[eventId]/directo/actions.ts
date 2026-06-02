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
  adjustClockPatch,
  adjustClockSchema,
  buildNextPeriod,
  type ClockMutation,
  type ClockPeriod,
  createSupabaseServerClient,
  currentPeriod,
  endPeriodPatch,
  matchEventRefSchema,
  nextPeriodAfter,
  isExpelled,
  pauseClockPatch,
  type PeriodKind,
  type PlayerEventType,
  playerEventClockFields,
  registerFieldEventSchema,
  registerPlayerEventSchema,
  resolveCardOutcome,
  resumeClockPatch,
  startNextPeriodSchema,
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
