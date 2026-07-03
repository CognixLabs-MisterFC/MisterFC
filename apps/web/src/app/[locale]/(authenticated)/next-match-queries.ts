/**
 * F7.12 — Panel de "próximo partido" en Inicio.
 *
 * Lee datos existentes (sin migración):
 *   - match_callup_meta.published_at  (F4) → convocatoria enviada o no.
 *   - callup_decisions / callup_responses (F4) → convocados (X/Y) y respuestas.
 *   - lineups.is_official (F6) → alineación oficial del partido.
 *   - match_state.status (F7.1) → not_started / live / closed.
 *
 * "Confirmación" = el convocado HA RESPONDIDO a la convocatoria (yes/maybe/no).
 * Usamos "respondió" (no solo 'yes') para que un 'no'/'duda' no bloquee el
 * avance de estado: el coach pasa a la alineación cuando ya no faltan respuestas.
 */

import {
  MATCH_SURFACE_TYPES,
  callupEventIdFor,
  filterPublishedByAnchor,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CoachMatchState =
  | 'prepare_callup' // 1. falta preparar/enviar convocatoria
  | 'awaiting_confirmations' // 2. enviada, faltan confirmaciones (X/Y)
  | 'needs_lineup' // 3. confirmados, sin alineación oficial
  | 'ready' // 4. oficial lista
  | 'post_match'; // 5. partido cerrado

export type CoachNextMatch = {
  eventId: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  teamName: string;
  /** F13B — cabecera del torneo si es un sub-partido; null en partido normal. */
  tournamentId: string | null;
  /** F13B — ronda del sub-partido (1,2,3…); null si no es de torneo. */
  round: number | null;
  state: CoachMatchState;
  /** Convocados que ya han respondido (X). */
  confirmed: number;
  /** Total de convocados (Y). */
  calledUp: number;
  /** Desglose de respuestas entre convocados. */
  yes: number;
  no: number;
  maybe: number;
};

export type PlayerPendingCallup = {
  eventId: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  /** F13B — cabecera del torneo si es un sub-partido; null en partido normal. */
  tournamentId: string | null;
  /** F13B — ronda del sub-partido (1,2,3…); null si no es de torneo. */
  round: number | null;
  /** Nº de jugadores propios pendientes de responder en este partido. */
  pendingCount: number;
} | null;

/**
 * Próximo partido del cuerpo técnico (equipos donde es team_staff activo) con su
 * estado para el panel de Inicio. null si no tiene equipos o no hay partido futuro.
 */
export async function loadCoachNextMatch(
  membershipId: string,
): Promise<CoachNextMatch | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: staffRows } = await supabase
    .from('team_staff')
    .select('team_id')
    .eq('membership_id', membershipId)
    .is('left_at', null);
  const teamIds = (staffRows ?? []).map((r) => r.team_id as string);
  if (teamIds.length === 0) return null;

  const nowIso = new Date().toISOString();
  const { data: evRows } = await supabase
    .from('events')
    .select(
      'id, title, opponent_name, starts_at, team_id, type, tournament_id, round, teams!inner(name)',
    )
    .in('team_id', teamIds)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .order('starts_at', { ascending: true })
    .limit(1);
  type EvShape = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    team_id: string;
    tournament_id: string | null;
    round: number | null;
    teams: { name: string };
  };
  const ev = (evRows ?? [])[0] as unknown as EvShape | undefined;
  if (!ev) return null;

  // F13B (T-2) — convocatoria (meta/decisiones/respuestas) de la CABECERA si el
  // próximo partido es de un torneo; si no, del propio evento.
  const callupEventId = callupEventIdFor(ev);

  // Estado del partido (F7.1). Sin fila → not_started.
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', ev.id)
    .maybeSingle();
  const status = (stateRow?.status as string | undefined) ?? null;

  // Alineación oficial (F6).
  const { data: officialRow } = await supabase
    .from('lineups')
    .select('id')
    .eq('event_id', ev.id)
    .eq('is_official', true)
    .maybeSingle();
  const hasOfficial = officialRow != null;

  // Convocatoria enviada (F4).
  const { data: metaRow } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', callupEventId)
    .maybeSingle();
  const published = (metaRow?.published_at as string | null | undefined) != null;

  // X/Y — convocados = roster a la fecha menos descartados; X = los que respondieron.
  const eventDate = ev.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('player_id, joined_at, left_at')
    .eq('team_id', ev.team_id)
    .lte('joined_at', eventDate);
  const rosterIds = (rosterRows ?? [])
    .filter((r) => r.left_at == null || (r.left_at as string) >= eventDate)
    .map((r) => r.player_id as string);

  const { data: decRows } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', callupEventId);
  const discarded = new Set(
    (decRows ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => d.player_id as string),
  );
  const calledUpIds = rosterIds.filter((pid) => !discarded.has(pid));
  const calledUp = calledUpIds.length;

  const { data: respRows } = await supabase
    .from('callup_responses')
    .select('player_id, status')
    .eq('event_id', callupEventId);
  // Mapa respuesta por jugador (solo convocados cuentan).
  const calledUpSet = new Set(calledUpIds);
  const statusByPlayer = new Map<string, string>();
  for (const r of respRows ?? []) {
    if (calledUpSet.has(r.player_id as string)) {
      statusByPlayer.set(r.player_id as string, r.status as string);
    }
  }
  const confirmed = statusByPlayer.size;
  let yes = 0;
  let no = 0;
  let maybe = 0;
  for (const s of statusByPlayer.values()) {
    if (s === 'yes') yes += 1;
    else if (s === 'no') no += 1;
    else if (s === 'maybe') maybe += 1;
  }

  // Máquina de estados (orden de prioridad).
  let state: CoachMatchState;
  if (status === 'closed') {
    state = 'post_match';
  } else if (hasOfficial) {
    state = 'ready';
  } else if (published && calledUp > 0 && confirmed >= calledUp) {
    state = 'needs_lineup';
  } else if (published) {
    state = 'awaiting_confirmations';
  } else {
    state = 'prepare_callup';
  }

  return {
    eventId: ev.id,
    title: ev.title,
    opponentName: ev.opponent_name,
    startsAt: ev.starts_at,
    teamName: ev.teams.name,
    tournamentId: ev.tournament_id,
    round: ev.round,
    state,
    confirmed,
    calledUp,
    yes,
    no,
    maybe,
  };
}

/**
 * ¿El jugador/familia tiene alguna convocatoria PUBLICADA próxima con jugador
 * propio convocado (no descartado) y SIN responder? Devuelve la más cercana.
 */
export async function loadPlayerPendingCallup(
  playerIds: string[],
): Promise<PlayerPendingCallup> {
  if (playerIds.length === 0) return null;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: tmRows } = await supabase
    .from('team_members')
    .select('player_id, team_id, joined_at, left_at')
    .in('player_id', playerIds);
  type TmShape = {
    player_id: string;
    team_id: string;
    joined_at: string;
    left_at: string | null;
  };
  const memberships = (tmRows ?? []).map((r) => r as unknown as TmShape);
  const teamIds = [...new Set(memberships.map((r) => r.team_id))];
  if (teamIds.length === 0) return null;

  const nowIso = new Date().toISOString();
  const horizonIso = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { data: evRows } = await supabase
    .from('events')
    .select(
      'id, title, opponent_name, starts_at, team_id, type, tournament_id, round',
    )
    .in('team_id', teamIds)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', horizonIso)
    .order('starts_at', { ascending: true });
  type EvShape = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    team_id: string;
    tournament_id: string | null;
    round: number | null;
  };
  const events = (evRows ?? []).map((e) => e as unknown as EvShape);
  if (events.length === 0) return null;

  // F13B — la convocatoria (meta/decisiones/respuestas) de un sub-partido de
  // torneo vive en la CABECERA: resolvemos contra `callupEventIdFor(ev)`. Para un
  // partido normal es su propio id → comportamiento idéntico. El embed de la meta
  // del propio evento no serviría (la del sub-partido está vacía), así que la
  // consultamos por el conjunto de anclas.
  const anchorOf = new Map<string, string>();
  for (const e of events) anchorOf.set(e.id, callupEventIdFor(e));
  const anchorIds = [...new Set(anchorOf.values())];

  const { data: metaRows } = await supabase
    .from('match_callup_meta')
    .select('event_id, published_at')
    .in('event_id', anchorIds)
    .not('published_at', 'is', null);
  const publishedAnchors = new Set(
    (metaRows ?? []).map((m) => m.event_id as string),
  );
  const publishedEvents = filterPublishedByAnchor(events, publishedAnchors);
  if (publishedEvents.length === 0) return null;

  const { data: decRows } = await supabase
    .from('callup_decisions')
    .select('event_id, player_id, decision')
    .in('event_id', anchorIds)
    .in('player_id', playerIds);
  const discarded = new Set(
    (decRows ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => `${d.event_id as string}:${d.player_id as string}`),
  );
  const { data: respRows } = await supabase
    .from('callup_responses')
    .select('event_id, player_id')
    .in('event_id', anchorIds)
    .in('player_id', playerIds);
  const responded = new Set(
    (respRows ?? []).map((r) => `${r.event_id as string}:${r.player_id as string}`),
  );

  for (const e of publishedEvents) {
    // Decisiones/respuestas se leen contra el ancla (cabecera si es torneo).
    const anchorId = callupEventIdFor(e);
    const eventDate = e.starts_at.slice(0, 10);
    const myInTeam = memberships
      .filter(
        (m) =>
          m.team_id === e.team_id &&
          m.joined_at <= eventDate &&
          (m.left_at == null || m.left_at >= eventDate),
      )
      .map((m) => m.player_id);
    const pending = myInTeam.filter(
      (pid) =>
        !discarded.has(`${anchorId}:${pid}`) &&
        !responded.has(`${anchorId}:${pid}`),
    );
    if (pending.length > 0) {
      return {
        eventId: e.id,
        title: e.title,
        opponentName: e.opponent_name,
        startsAt: e.starts_at,
        tournamentId: e.tournament_id,
        round: e.round,
        pendingCount: pending.length,
      };
    }
  }
  return null;
}
