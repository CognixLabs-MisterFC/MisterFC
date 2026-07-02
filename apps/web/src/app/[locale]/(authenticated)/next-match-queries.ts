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

import { MATCH_SURFACE_TYPES, createSupabaseServerClient } from '@misterfc/core';
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
  /** Nº de jugadores propios pendientes de responder en este partido. */
  pendingCount: number;
} | null;

type MetaEmbed =
  | { published_at: string | null }
  | { published_at: string | null }[]
  | null;

function isPublished(meta: MetaEmbed): boolean {
  if (!meta) return false;
  if (Array.isArray(meta)) return meta.length > 0 && meta[0]?.published_at != null;
  return meta.published_at != null;
}

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
    .select('id, title, opponent_name, starts_at, team_id, type, teams!inner(name)')
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
    teams: { name: string };
  };
  const ev = (evRows ?? [])[0] as unknown as EvShape | undefined;
  if (!ev) return null;

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
    .eq('event_id', ev.id)
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
    .eq('event_id', ev.id);
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
    .eq('event_id', ev.id);
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
      'id, title, opponent_name, starts_at, team_id, match_callup_meta(published_at)',
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
    match_callup_meta: MetaEmbed;
  };
  const events = (evRows ?? [])
    .map((e) => e as unknown as EvShape)
    .filter((e) => isPublished(e.match_callup_meta));
  if (events.length === 0) return null;

  const eventIds = events.map((e) => e.id);
  const { data: decRows } = await supabase
    .from('callup_decisions')
    .select('event_id, player_id, decision')
    .in('event_id', eventIds)
    .in('player_id', playerIds);
  const discarded = new Set(
    (decRows ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => `${d.event_id as string}:${d.player_id as string}`),
  );
  const { data: respRows } = await supabase
    .from('callup_responses')
    .select('event_id, player_id')
    .in('event_id', eventIds)
    .in('player_id', playerIds);
  const responded = new Set(
    (respRows ?? []).map((r) => `${r.event_id as string}:${r.player_id as string}`),
  );

  for (const e of events) {
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
        !discarded.has(`${e.id}:${pid}`) && !responded.has(`${e.id}:${pid}`),
    );
    if (pending.length > 0) {
      return {
        eventId: e.id,
        title: e.title,
        opponentName: e.opponent_name,
        startsAt: e.starts_at,
        pendingCount: pending.length,
      };
    }
  }
  return null;
}
