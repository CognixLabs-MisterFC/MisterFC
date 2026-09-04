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

/** Próximos eventos (no cancelados, aprobados) en un rango ISO.
 *  `onError`: sumidero de errores del caller (native: Sentry). INSTRUMENTACIÓN — un
 *  fallo de RLS/Postgres dejaba `[]` mudo ("sin eventos próximos") sin rastro; con el
 *  sink se ve. Core no depende de Sentry (mismo patrón que team-view, #487).
 *
 *  `teamIds`: si se pasa, acota los eventos a esos equipos ANTES del `limit`
 *  (imprescindible: filtrar en cliente tras un top-5 club-wide dejaría fuera los del
 *  equipo). SIN el parámetro NO hay filtro de equipo: se devuelve lo que deje la RLS, y
 *  la RLS de `events` abre los partidos/amistosos/torneos a TODO el club a propósito
 *  (F7B-2) → sale un evento de otro equipo. Por eso quien quiera "los míos" tiene que
 *  pasar teamIds; no basta con confiar en la RLS.
 *
 *  LISTA VACÍA ≠ SIN FILTRO: `teamIds = []` significa "no tiene equipos" y devuelve []
 *  SIN consultar. Caer a club-wide ahí sería volver a colar eventos ajenos, y mandar
 *  `.in('team_id', [])` es una consulta que siempre da cero filas. */
export async function getUpcomingEventsFromClient(
  supabase: DbClient,
  fromIso: string,
  toIso: string,
  limit = 5,
  onError?: (err: unknown) => void,
  teamIds?: string[]
): Promise<UpcomingEvent[]> {
  if (teamIds && teamIds.length === 0) return [];
  let query = supabase
    .from('events')
    .select('id, title, type, starts_at, team_id, teams(name)')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso);
  if (teamIds) query = query.in('team_id', teamIds);
  const { data, error } = await query
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) onError?.(error);
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

/** El próximo evento de UN hijo. `event` null = ese hijo no tiene ninguno. */
export type PlayerNextEvent = {
  playerId: string;
  event: UpcomingEvent | null;
};

/**
 * Tope de eventos que se traen para repartir entre los hijos.
 *
 * No es el número de tarjetas: es cuántos eventos de la ventana se miran para
 * encontrar el primero de CADA hijo. Con un `limit 5` como el de la tarjeta
 * única, un equipo con muchos entrenos podría llenar el cupo y dejar al otro
 * hijo sin el suyo. 50 en una ventana de 7 días es holgado de sobra.
 */
const NEXT_EVENT_SCAN_CAP = 50;

/**
 * El próximo evento DE CADA HIJO, para el inicio de familia.
 *
 * POR QUÉ EXISTE: la tarjeta única llamaba a `getUpcomingEventsFromClient` sin
 * `teamIds` y se quedaba con el primero de lo que devolviera la RLS. Como la RLS
 * de `events` abre los partidos a TODO el club a propósito (F7B-2), a una familia
 * del Alevín le salía un amistoso del Infantil B. El filtro por equipo tiene que
 * estar aquí, no en la RLS.
 *
 * TRES CONSULTAS, y NO dependen del número de hijos (nada de N+1):
 *   1. `user_team_ids_in_club` — la MISMA RPC que usa el calendario de familia.
 *      Es la que sabe de temporadas: acota a la temporada ACTIVA. Sin ella habría
 *      que repetir aquí ese filtro, y en producción cada equipo existe duplicado
 *      entre temporadas y más de la mitad de las filas de `team_members` son
 *      históricas.
 *   2. `team_members` de todos los hijos a la vez → de QUIÉN es cada equipo.
 *   3. los eventos de la UNIÓN de esos equipos, repartidos en memoria.
 *
 * Las dos primeras van en paralelo. La 1 da el conjunto permitido y la 2 la
 * atribución por hijo: la intersección es "los equipos de ESTE hijo, de esta
 * temporada".
 *
 * Devuelve SIEMPRE una entrada por hijo y en el mismo orden en que llegan: un
 * hijo sin eventos trae `event: null` y su tarjeta se queda con el texto de
 * vacío, no desaparece.
 */
export async function getNextEventPerPlayerFromClient(
  supabase: DbClient,
  clubId: string,
  playerIds: string[],
  fromIso: string,
  toIso: string,
  onError?: (err: unknown) => void
): Promise<PlayerNextEvent[]> {
  if (playerIds.length === 0) return [];
  const empty = playerIds.map((playerId) => ({ playerId, event: null }));

  const [scopeRes, memberRes] = await Promise.all([
    supabase.rpc('user_team_ids_in_club', { p_club_id: clubId }),
    supabase
      .from('team_members')
      .select('player_id, team_id')
      .in('player_id', playerIds)
      .is('left_at', null),
  ]);
  if (scopeRes.error) onError?.(scopeRes.error);
  if (memberRes.error) onError?.(memberRes.error);

  // Equipos de la temporada activa. Fuera de este conjunto no se mira nada: es lo
  // que descarta los equipos de temporadas pasadas.
  const inSeason = new Set(
    ((scopeRes.data ?? []) as unknown as string[]).filter(Boolean)
  );

  type MemberRow = { player_id: string; team_id: string };
  const teamsByPlayer = new Map<string, string[]>();
  for (const row of (memberRes.data ?? []) as unknown as MemberRow[]) {
    if (!inSeason.has(row.team_id)) continue;
    const acc = teamsByPlayer.get(row.player_id);
    if (acc) acc.push(row.team_id);
    else teamsByPlayer.set(row.player_id, [row.team_id]);
  }

  const union = [...new Set([...teamsByPlayer.values()].flat())];
  // Ningún hijo con equipo en la temporada activa: nada que consultar. Cada uno se
  // queda con su tarjeta vacía.
  if (union.length === 0) return empty;

  const events = await getUpcomingEventsFromClient(
    supabase,
    fromIso,
    toIso,
    NEXT_EVENT_SCAN_CAP,
    onError,
    union
  );

  // Ya vienen ordenados por fecha: el primero que case con un equipo del hijo es
  // el suyo. Dos hermanos del MISMO equipo comparten evento a propósito.
  return playerIds.map((playerId) => {
    const teams = teamsByPlayer.get(playerId);
    if (!teams || teams.length === 0) return { playerId, event: null };
    const event = events.find((e) => e.team_id != null && teams.includes(e.team_id));
    return { playerId, event: event ?? null };
  });
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
