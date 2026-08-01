import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MANAGEABLE_MATCH_TYPES } from '../events/types';

/**
 * O2-6 — Partidos CERRADOS (jugados) de un equipo, para las estadísticas del
 * seguidor (lista de partidos → fila E1 del jugador seguido en cada uno). SOLO
 * LECTURA. La RLS del seguidor abre `events` de su equipo (is_spectator_of_team) y
 * `match_state` club-wide (is_spectator_of_club); aquí solo se leen y se cruzan.
 *
 * Devuelve solo los que tienen `match_state.status = 'closed'` (las filas de
 * `match_player_stats` solo existen al cerrar), con marcador final. Orden reciente
 * primero.
 */
type DbClient = SupabaseClient<Database>;

export type ClosedTeamMatch = {
  eventId: string;
  title: string;
  opponentName: string | null;
  startsAt: string;
  teamName: string;
  categoryName: string;
  goalsOwn: number;
  goalsRival: number;
};

export async function getClosedTeamMatchesFromClient(
  supabase: DbClient,
  teamId: string
): Promise<ClosedTeamMatch[]> {
  const { data: evRows } = await supabase
    .from('events')
    .select(
      `id, title, opponent_name, starts_at,
       teams!inner(name, categories!inner(name))`
    )
    .eq('team_id', teamId)
    .in('type', MANAGEABLE_MATCH_TYPES)
    .order('starts_at', { ascending: false });

  type EvRow = {
    id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: { name: string; categories: { name: string } };
  };
  const events = (evRows ?? []) as unknown as EvRow[];
  if (events.length === 0) return [];

  const ids = events.map((e) => e.id);
  const { data: stateRows } = await supabase
    .from('match_state')
    .select('event_id, status, goals_for, goals_against')
    .in('event_id', ids)
    .eq('status', 'closed');

  type StateRow = {
    event_id: string;
    goals_for: number | null;
    goals_against: number | null;
  };
  const closedByEvent = new Map<string, StateRow>();
  for (const s of (stateRows ?? []) as StateRow[]) closedByEvent.set(s.event_id, s);

  return events
    .filter((e) => closedByEvent.has(e.id))
    .map((e) => {
      const st = closedByEvent.get(e.id)!;
      return {
        eventId: e.id,
        title: e.title,
        opponentName: e.opponent_name,
        startsAt: e.starts_at,
        teamName: e.teams.name,
        categoryName: e.teams.categories.name,
        goalsOwn: st.goals_for ?? 0,
        goalsRival: st.goals_against ?? 0,
      };
    });
}
