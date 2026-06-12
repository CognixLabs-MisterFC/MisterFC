/**
 * F9.B-0 — Carga de las stats agregadas de un EQUIPO en su temporada (habilitador
 * de 9.B-3 y del PDF de equipo 9.8). SOLO datos + lógica; sin UI.
 *
 * El team es season-scoped (Rework C: `teams.season` es un único label por fila
 * de equipo), así que el roster = todas las membresías de `team_members` de ese
 * team (activas e históricas: un jugador que se fue a mitad de temporada también
 * contó). Las stats son `match_player_stats` filtradas por `team_id`.
 *
 * Seguridad: se apoya en la RLS existente — `match_player_stats_select`
 * (`user_can_record_match`: admin/coord del club o staff del team), `players` y
 * `team_members` (clubmate). No se añade política nueva.
 */

import {
  aggregateTeamStats,
  createSupabaseServerClient,
  type RosterPlayer,
  type PlayerMatchStatRow,
  type TeamAggregate,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export interface TeamSeasonStats {
  team: {
    id: string;
    name: string;
    season: string;
    color: string;
    club_id: string;
    category_name: string;
  };
  aggregate: TeamAggregate;
}

/**
 * Devuelve la cabecera del equipo + el agregado de stats de su temporada.
 * `null` si el equipo no existe o no es visible para el usuario (RLS). El
 * agregado se calcula en core (`aggregateTeamStats`).
 */
export async function loadTeamSeasonStats(
  teamId: string
): Promise<TeamSeasonStats | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Cabecera del equipo (la RLS de teams lo oculta si no es del club del user).
  const { data: t } = await supabase
    .from('teams')
    .select('id, name, season, color, club_id, categories!inner(name)')
    .eq('id', teamId)
    .maybeSingle();
  if (!t) return null;

  type TeamRow = {
    id: string;
    name: string;
    season: string;
    color: string;
    club_id: string;
    categories: { name: string };
  };
  const team = t as unknown as TeamRow;

  // 2) Roster del equipo (todas las membresías, el team es season-scoped).
  type TmRow = {
    player_id: string;
    dorsal_in_team: number | null;
    position_in_team: string | null;
    players: { first_name: string; last_name: string | null };
  };
  const { data: rawRoster } = await supabase
    .from('team_members')
    .select(
      'player_id, dorsal_in_team, position_in_team, players!inner(first_name, last_name)'
    )
    .eq('team_id', teamId)
    .order('dorsal_in_team', { ascending: true, nullsFirst: false });

  const roster: RosterPlayer[] = ((rawRoster ?? []) as unknown as TmRow[]).map(
    (r) => ({
      player_id: r.player_id,
      first_name: r.players.first_name,
      last_name: r.players.last_name,
      dorsal_in_team: r.dorsal_in_team,
      position_in_team: r.position_in_team,
    })
  );

  // 3) match_player_stats del equipo (RLS: staff del team / admin / coord).
  const { data: rawStats } = await supabase
    .from('match_player_stats')
    .select(
      'player_id, started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed'
    )
    .eq('team_id', teamId);

  const rows = (rawStats ?? []) as unknown as PlayerMatchStatRow[];

  return {
    team: {
      id: team.id,
      name: team.name,
      season: team.season,
      color: team.color,
      club_id: team.club_id,
      category_name: team.categories.name,
    },
    aggregate: aggregateTeamStats(roster, rows),
  };
}
