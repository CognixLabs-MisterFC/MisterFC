import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MATCH_SURFACE_TYPES } from '../events/types';
import { callupEventIdFor, filterPublishedByAnchor } from '../events/aggregation';

/**
 * O2-5 B1 — Datos del Inicio de familia (lectura), extraído de `apps/web/.../page.tsx`
 * y `next-match-queries.ts`. Rama de jugador/familia (agrega por RLS/scope).
 */
type DbClient = SupabaseClient<Database>;

export type UpcomingEvent = {
  id: string;
  title: string;
  type: string;
  starts_at: string;
  team_id: string | null;
  teamName: string | null;
};

export type PlayerPendingCallup = {
  eventId: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  tournamentId: string | null;
  round: number | null;
  pendingCount: number;
} | null;

/** Nº de conversaciones con mensajes no leídos (RPC SECURITY DEFINER). */
export async function getUnreadConversationsCountFromClient(
  supabase: DbClient
): Promise<number> {
  const { data } = await supabase.rpc('user_unread_conversations_count');
  return typeof data === 'number' ? data : 0;
}

/** Próximos eventos (no cancelados, aprobados) en un rango ISO. */
export async function getUpcomingEventsFromClient(
  supabase: DbClient,
  fromIso: string,
  toIso: string,
  limit = 5
): Promise<UpcomingEvent[]> {
  const { data } = await supabase
    .from('events')
    .select('id, title, type, starts_at, team_id, teams(name)')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(limit);
  type Ev = {
    id: string;
    title: string;
    type: string;
    starts_at: string;
    team_id: string | null;
    teams: { name: string } | null;
  };
  return ((data ?? []) as unknown as Ev[]).map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    starts_at: e.starts_at,
    team_id: e.team_id,
    teamName: e.teams?.name ?? null,
  }));
}

/**
 * Convocatoria PUBLICADA próxima (30d) con jugador propio convocado (no
 * descartado) y SIN responder → la más cercana. Espejo de `loadPlayerPendingCallup`.
 */
export async function getPlayerPendingCallupFromClient(
  supabase: DbClient,
  playerIds: string[]
): Promise<PlayerPendingCallup> {
  if (playerIds.length === 0) return null;

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
    .select('id, title, opponent_name, starts_at, team_id, type, tournament_id, round')
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

  const anchorOf = new Map<string, string>();
  for (const e of events) anchorOf.set(e.id, callupEventIdFor(e));
  const anchorIds = [...new Set(anchorOf.values())];

  const { data: metaRows } = await supabase
    .from('match_callup_meta')
    .select('event_id, published_at')
    .in('event_id', anchorIds)
    .not('published_at', 'is', null);
  const publishedAnchors = new Set((metaRows ?? []).map((m) => m.event_id as string));
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
      .map((d) => `${d.event_id as string}:${d.player_id as string}`)
  );
  const { data: respRows } = await supabase
    .from('callup_responses')
    .select('event_id, player_id')
    .in('event_id', anchorIds)
    .in('player_id', playerIds);
  const responded = new Set(
    (respRows ?? []).map((r) => `${r.event_id as string}:${r.player_id as string}`)
  );

  for (const e of publishedEvents) {
    const anchorId = callupEventIdFor(e);
    const eventDate = e.starts_at.slice(0, 10);
    const myInTeam = memberships
      .filter(
        (m) =>
          m.team_id === e.team_id &&
          m.joined_at <= eventDate &&
          (m.left_at == null || m.left_at >= eventDate)
      )
      .map((m) => m.player_id);
    const pending = myInTeam.filter(
      (pid) =>
        !discarded.has(`${anchorId}:${pid}`) && !responded.has(`${anchorId}:${pid}`)
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
