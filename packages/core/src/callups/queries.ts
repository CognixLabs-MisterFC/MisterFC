/**
 * O2-5 E1 — Queries de convocatorias PLAYER-SCOPED, framework-agnósticas.
 *
 * Extraídas de `apps/web/.../convocatorias/queries.ts` (rama `scope='player'`) y
 * de la acción `upsertCallupResponse`, para que la app nativa de FAMILIA las
 * consuma bajo el HIJO ACTIVO. La web pasa a delegar su rama de jugador en
 * `getPlayerCallupsFromClient` (comportamiento idéntico: mismas queries + RLS).
 *
 * Autorización: NO se reimplementa. La lectura la acota la RLS de
 * `callup_responses`/`callup_decisions`/`events`; la escritura la autoriza
 * `user_owns_player_account(player_id)` (F4.3) — un tutor responde por su hijo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  type CallupDecisionKind,
  type CallupResponseStatus,
  type TransportMode,
  type UpsertCallupResponseInput,
} from '../schemas/index';
import { MANAGEABLE_MATCH_TYPES } from '../events/index';
import { groupRosterByCallup } from '../lineups/index';

type Sb = SupabaseClient<Database>;

/**
 * Fila de la lista de convocatorias tal como la produce la rama de jugador de la
 * web (`CallupMatchRow`), MÁS `my_decision` (convocado/descartado del hijo), que
 * la app nativa muestra. Superset estructural de `CallupMatchRow` → la web puede
 * devolver esto sin cambiar su tipo de retorno.
 */
export type PlayerCallupRow = {
  event_id: string;
  team_id: string;
  type: string;
  tournament_id: string | null;
  round: number | null;
  team_name: string;
  team_color: string;
  category_name: string;
  category_season: string;
  title: string;
  opponent_name: string | null;
  starts_at: string;
  published: boolean;
  meeting_at: string | null;
  meeting_location: string | null;
  responses_count: { yes: number; maybe: number; no: number };
  decisions_count: { called_up: number; discarded: number };
  roster_count: number;
  my_response: CallupResponseStatus | null;
  can_record_match: boolean;
  /** E1 — decisión técnica sobre el hijo (solo si publicada): convocado/descartado. */
  my_decision: CallupDecisionKind | null;
};

export type PlayerCallupDetailPlayer = {
  id: string;
  first_name: string;
  last_name: string;
  dorsal: number | null;
  is_promoted: boolean;
  from_team_name: string | null;
  /** Roster VIGENTE a la fecha del partido (los subidos también cuentan). */
  in_callup: boolean;
  response: CallupResponseStatus | null;
  reason: string | null;
  decision: CallupDecisionKind | null;
};

export type PlayerCallupDetail = {
  event: {
    id: string;
    team_id: string;
    type: string;
    team_name: string;
    team_color: string;
    category_name: string;
    category_season: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
    tournament_id: string | null;
  };
  meeting_at: string | null;
  meeting_location: string | null;
  meeting_address: string | null;
  transport_mode: TransportMode | null;
  transport_notes: string | null;
  notes_general: string | null;
  published: boolean;
  players: PlayerCallupDetailPlayer[];
};

type EventRow = {
  id: string;
  club_id: string;
  team_id: string;
  type: string;
  tournament_id: string | null;
  round: number | null;
  title: string;
  opponent_name: string | null;
  starts_at: string;
  teams: {
    name: string;
    color: string;
    season: string;
    categories: { name: string };
  };
};

/**
 * Partidos convocables de los equipos de `playerIds` en la ventana
 * `[fromIso, toIso]`. Réplica EXACTA de la rama `scope='player'` de
 * `loadUpcomingCallups`, parametrizando la ventana (la web usa [now, now+30d];
 * la app nativa amplía hacia atrás para el histórico). La RLS hace el resto.
 */
export async function getPlayerCallupsFromClient(
  supabase: Sb,
  clubId: string,
  playerIds: readonly string[],
  opts: { fromIso: string; toIso: string },
): Promise<PlayerCallupRow[]> {
  if (playerIds.length === 0) return [];

  // Equipos vigentes del/los jugador(es).
  const { data: tms } = await supabase
    .from('team_members')
    .select('team_id')
    .in('player_id', playerIds as string[])
    .is('left_at', null);
  const teamIds = Array.from(
    new Set((tms ?? []).map((t) => (t as { team_id: string }).team_id)),
  );
  if (teamIds.length === 0) return [];

  const { data: rawEvents } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, tournament_id, round, title, opponent_name, starts_at,
       teams!inner(name, color, season, categories!inner(name))`,
    )
    .eq('club_id', clubId)
    .in('type', MANAGEABLE_MATCH_TYPES)
    .gte('starts_at', opts.fromIso)
    .lte('starts_at', opts.toIso)
    .order('starts_at', { ascending: true })
    .limit(200)
    .in('team_id', teamIds);

  const events = (rawEvents ?? []).map((e) => e as unknown as EventRow);
  if (events.length === 0) return [];

  // Cabeceras de torneo referenciadas por sub-partidos en ventana (idéntico a web).
  const presentIds = new Set(events.map((e) => e.id));
  const missingHeaderIds = Array.from(
    new Set(
      events
        .map((e) => e.tournament_id)
        .filter((id): id is string => id != null && !presentIds.has(id)),
    ),
  );
  if (missingHeaderIds.length > 0) {
    const { data: headerRows } = await supabase
      .from('events')
      .select(
        `id, club_id, team_id, type, tournament_id, round, title, opponent_name, starts_at,
         teams!inner(name, color, season, categories!inner(name))`,
      )
      .eq('club_id', clubId)
      .in('id', missingHeaderIds);
    for (const h of (headerRows ?? []).map((e) => e as unknown as EventRow)) {
      if (!presentIds.has(h.id)) {
        events.push(h);
        presentIds.add(h.id);
      }
    }
  }

  const eventIds = events.map((e) => e.id);

  const { data: metas } = await supabase
    .from('match_callup_meta')
    .select('event_id, meeting_at, meeting_location, published_at')
    .in('event_id', eventIds);
  type MetaRow = {
    event_id: string;
    meeting_at: string;
    meeting_location: string;
    published_at: string | null;
  };
  const metaByEvent = new Map<string, MetaRow>();
  for (const m of (metas ?? []) as MetaRow[]) metaByEvent.set(m.event_id, m);

  const { data: rawResponses } = await supabase
    .from('callup_responses')
    .select('event_id, player_id, status')
    .in('event_id', eventIds);
  type ResShape = {
    event_id: string;
    player_id: string;
    status: CallupResponseStatus;
  };
  const responsesByEvent = new Map<string, ResShape[]>();
  for (const r of (rawResponses ?? []) as ResShape[]) {
    const list = responsesByEvent.get(r.event_id) ?? [];
    list.push(r);
    responsesByEvent.set(r.event_id, list);
  }

  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select('event_id, player_id, decision')
    .in('event_id', eventIds);
  type DecShape = {
    event_id: string;
    player_id: string;
    decision: CallupDecisionKind;
  };
  const discardedByEvent = new Map<string, Set<string>>();
  for (const d of (rawDecisions ?? []) as DecShape[]) {
    if (d.decision !== 'discarded') continue;
    const cur = discardedByEvent.get(d.event_id) ?? new Set<string>();
    cur.add(d.player_id);
    discardedByEvent.set(d.event_id, cur);
  }

  const evTeamIds = Array.from(new Set(events.map((e) => e.team_id)));
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('team_id, player_id, joined_at, left_at')
    .in('team_id', evTeamIds);
  type RosterRow = {
    team_id: string;
    player_id: string;
    joined_at: string;
    left_at: string | null;
  };
  const roster = (rosterRows ?? []).map((r) => r as unknown as RosterRow);

  const playerSet = new Set(playerIds as string[]);

  return events.map((e) => {
    const eventDate = e.starts_at.slice(0, 10);
    const rosterIds = roster
      .filter(
        (r) =>
          r.team_id === e.team_id &&
          r.joined_at <= eventDate &&
          (r.left_at == null || r.left_at >= eventDate),
      )
      .map((r) => r.player_id);
    const rosterCount = rosterIds.length;

    const responses = responsesByEvent.get(e.id) ?? [];
    const respCount = { yes: 0, maybe: 0, no: 0 };
    let myResponse: CallupResponseStatus | null = null;
    for (const r of responses) {
      respCount[r.status]++;
      if (playerSet.has(r.player_id)) myResponse = r.status;
    }

    const discardedSet = discardedByEvent.get(e.id) ?? new Set<string>();
    const groups = groupRosterByCallup(rosterIds, (pid) =>
      discardedSet.has(pid) ? 'discarded' : null,
    );
    const decisions = {
      called_up: groups.calledUp.length,
      discarded: groups.discarded.length,
    };
    const meta = metaByEvent.get(e.id) ?? null;
    const published = meta?.published_at != null;

    // Decisión sobre el hijo: solo tiene sentido si está publicada. Convocado =
    // en roster vigente y NO descartado; descartado = en el set de descartados.
    let myDecision: CallupDecisionKind | null = null;
    if (published) {
      const mine = rosterIds.find((pid) => playerSet.has(pid));
      if (mine) myDecision = discardedSet.has(mine) ? 'discarded' : 'called_up';
    }

    return {
      event_id: e.id,
      team_id: e.team_id,
      type: e.type,
      tournament_id: e.tournament_id,
      round: e.round,
      team_name: e.teams.name,
      team_color: e.teams.color,
      category_name: e.teams.categories.name,
      category_season: e.teams.season,
      title: e.title,
      opponent_name: e.opponent_name,
      starts_at: e.starts_at,
      published,
      meeting_at: meta?.meeting_at ?? null,
      meeting_location: meta?.meeting_location ?? null,
      responses_count: respCount,
      decisions_count: decisions,
      roster_count: rosterCount,
      my_response: myResponse,
      can_record_match: false,
      my_decision: myDecision,
    };
  });
}

/**
 * Detalle LEAN player-scoped para el visor de familia: cabecera del evento,
 * datos de citación y, por cada hijo de `playerIds`, su respuesta y decisión.
 * NO trae los datos staff (alineación, captura en directo, asistencia semanal):
 * eso vive en `loadCallupDetail` (web, multi-rol), que queda intacta.
 */
export async function getPlayerCallupDetailFromClient(
  supabase: Sb,
  clubId: string,
  eventId: string,
  playerIds: readonly string[],
): Promise<PlayerCallupDetail | null> {
  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, tournament_id, title, opponent_name, starts_at,
       location_name, location_address,
       teams!inner(name, color, season, categories!inner(name))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  type EvShape = {
    id: string;
    club_id: string;
    team_id: string | null;
    type: string;
    tournament_id: string | null;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    location_name: string | null;
    location_address: string | null;
    teams: {
      name: string;
      color: string;
      season: string;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EvShape;
  if (event.club_id !== clubId || event.team_id == null) return null;

  const eventDate = event.starts_at.slice(0, 10);
  const playerSet = new Set(playerIds as string[]);

  // Roster vigente a fecha (solo hijos) + jugadores subidos (solo hijos).
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal)',
    )
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type RosterShape = {
    player_id: string;
    joined_at: string;
    left_at: string | null;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      dorsal: number | null;
    };
  };
  const active = (rosterRows ?? [])
    .map((r) => r as unknown as RosterShape)
    .filter((r) => r.left_at == null || r.left_at >= eventDate);

  const { data: promoRows } = await supabase
    .from('player_promotions')
    .select(
      'player_id, players!inner(id, first_name, last_name, dorsal, team_members(left_at, teams(name)))',
    )
    .eq('event_id', event.id);
  type PromoShape = {
    player_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      dorsal: number | null;
      team_members: { left_at: string | null; teams: { name: string } | null }[];
    };
  };
  const promotedInfo = new Map<string, string | null>();
  const promoted = (promoRows ?? [])
    .map((r) => r as unknown as PromoShape)
    .filter((r) => !active.some((a) => a.player_id === r.player_id))
    .map((r) => {
      const base = (r.players.team_members ?? []).find((tm) => tm.left_at == null);
      promotedInfo.set(r.player_id, base?.teams?.name ?? null);
      return {
        id: r.players.id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        dorsal: r.players.dorsal,
      };
    });

  const { data: metaRow } = await supabase
    .from('match_callup_meta')
    .select(
      'meeting_at, meeting_location, meeting_address, transport_mode, transport_notes, notes_general, published_at',
    )
    .eq('event_id', eventId)
    .maybeSingle();
  const meta = metaRow as unknown as {
    meeting_at: string | null;
    meeting_location: string | null;
    meeting_address: string | null;
    transport_mode: TransportMode | null;
    transport_notes: string | null;
    notes_general: string | null;
    published_at: string | null;
  } | null;
  const published = meta?.published_at != null;

  const { data: rawResponses } = await supabase
    .from('callup_responses')
    .select('player_id, status, reason')
    .eq('event_id', eventId);
  const responseByPlayer = new Map<
    string,
    { status: CallupResponseStatus; reason: string | null }
  >();
  for (const r of (rawResponses ?? []) as {
    player_id: string;
    status: CallupResponseStatus;
    reason: string | null;
  }[]) {
    responseByPlayer.set(r.player_id, { status: r.status, reason: r.reason });
  }

  const { data: rawDecisions } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', eventId);
  const decisionByPlayer = new Map<string, CallupDecisionKind>();
  for (const d of (rawDecisions ?? []) as {
    player_id: string;
    decision: CallupDecisionKind;
  }[]) {
    decisionByPlayer.set(d.player_id, d.decision);
  }

  // Solo los hijos: los del roster vigente + los subidos, intersecados con playerIds.
  const rosterOwned = active
    .filter((r) => playerSet.has(r.player_id))
    .map((r) => ({
      id: r.players.id,
      first_name: r.players.first_name,
      last_name: r.players.last_name,
      dorsal: r.players.dorsal,
      is_promoted: false,
      from_team_name: null as string | null,
    }));
  const promotedOwned = promoted
    .filter((p) => playerSet.has(p.id))
    .map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      dorsal: p.dorsal,
      is_promoted: true,
      from_team_name: promotedInfo.get(p.id) ?? null,
    }));

  const players: PlayerCallupDetailPlayer[] = [...rosterOwned, ...promotedOwned].map(
    (p) => {
      const resp = responseByPlayer.get(p.id) ?? null;
      const rawDecision = decisionByPlayer.get(p.id) ?? null;
      // Convocado DERIVADO: en convocatoria y sin descarte → called_up (solo si publicada).
      const decision: CallupDecisionKind | null = published
        ? rawDecision === 'discarded'
          ? 'discarded'
          : 'called_up'
        : null;
      return {
        ...p,
        in_callup: true,
        response: resp?.status ?? null,
        reason: resp?.reason ?? null,
        decision,
      };
    },
  );

  return {
    event: {
      id: event.id,
      team_id: event.team_id,
      type: event.type,
      team_name: event.teams.name,
      team_color: event.teams.color,
      category_name: event.teams.categories.name,
      category_season: event.teams.season,
      title: event.title,
      opponent_name: event.opponent_name,
      starts_at: event.starts_at,
      location_name: event.location_name,
      location_address: event.location_address,
      tournament_id: event.tournament_id,
    },
    meeting_at: meta?.meeting_at ?? null,
    meeting_location: meta?.meeting_location ?? null,
    meeting_address: meta?.meeting_address ?? null,
    transport_mode: meta?.transport_mode ?? null,
    transport_notes: meta?.transport_notes ?? null,
    notes_general: meta?.notes_general ?? null,
    published,
    players,
  };
}

export type RespondCallupResult =
  | { ok: true }
  | { ok: false; noUser?: boolean; message?: string; code?: string };

/**
 * Escritura de respuesta de convocatoria (yes/maybe/no) POR el `player_id` del
 * input. Réplica de la lógica DB de `upsertCallupResponse` (web): SELECT previo
 * → UPDATE si existe / INSERT con `responded_by = auth.uid()`. El gate
 * tutor→hijo lo impone la RLS (`user_owns_player_account`); aquí NO se
 * reimplementa. Devuelve el error pg crudo para que cada front lo mapee.
 *
 * `input` ya validado con `upsertCallupResponseSchema` por el llamante.
 */
export async function respondCallupFromClient(
  supabase: Sb,
  input: UpsertCallupResponseInput,
): Promise<RespondCallupResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, noUser: true };

  const { data: existing } = await supabase
    .from('callup_responses')
    .select('id')
    .eq('event_id', input.event_id)
    .eq('player_id', input.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('callup_responses')
      .update({ status: input.status, reason: input.reason })
      .eq('id', existing.id as string);
    if (error) return { ok: false, message: error.message, code: error.code };
  } else {
    const { error } = await supabase.from('callup_responses').insert({
      event_id: input.event_id,
      player_id: input.player_id,
      status: input.status,
      reason: input.reason,
      responded_by: user.id,
    });
    if (error) return { ok: false, message: error.message, code: error.code };
  }
  return { ok: true };
}
