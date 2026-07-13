/**
 * F14E-6 — Plantilla deportiva del jugador: roster de UN equipo con stats
 * agregadas por jugador, SOLO-LECTURA.
 *
 * Scope: un único `teamId` (un equipo del jugador). El aislamiento por equipo lo
 * da la query (`team_members`/`match_player_stats` filtrados por `team_id`); la
 * RLS `match_player_stats_select_teammate` (F14E-6) permite al jugador leer las
 * stats de los players de su equipo. La identidad sale de `players_sporting`
 * (proyección SOLO-deportiva; F14C) — sin datos personales. La agregación reutiliza
 * `aggregateTeamStats` de core (no se reinventa).
 */

import {
  createSupabaseServerClient,
  aggregateTeamStats,
  type RosterPlayer,
  type PlayerMatchStatRow,
  type AggregatedStats,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type RosterStatRow = {
  player_id: string;
  first_name: string;
  last_name: string | null;
  /** Dorsal efectivo: override del equipo ?? dorsal deportivo. */
  dorsal: number | null;
  /** Posición efectiva: override del equipo ?? posición principal. */
  position: string | null;
  foot: string | null;
  stats: AggregatedStats;
};

export async function loadTeamRosterStats(
  teamId: string,
): Promise<RosterStatRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Roster del equipo (override del día por equipo). RLS team_members = clubmate.
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('player_id, dorsal_in_team, position_in_team')
    .eq('team_id', teamId)
    .is('left_at', null);
  type TM = {
    player_id: string;
    dorsal_in_team: number | null;
    position_in_team: string | null;
  };
  const tm = (tmRows ?? []) as TM[];
  if (tm.length === 0) return [];
  const ids = tm.map((r) => r.player_id);

  // 2) Identidad SOLO-deportiva (F14C: el jugador tiene SELECT en players_sporting).
  const { data: spRows } = await supabase
    .from('players_sporting')
    .select('id, first_name, last_name, dorsal, position_main, foot')
    .in('id', ids);
  type SP = {
    id: string;
    first_name: string;
    last_name: string | null;
    dorsal: number | null;
    position_main: string | null;
    foot: string | null;
  };
  const spById = new Map(((spRows ?? []) as SP[]).map((s) => [s.id, s]));

  // 3) Stats de match del equipo (RLS F14E-6: compañero de equipo).
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(
      'player_id, started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed',
    )
    .eq('team_id', teamId);
  const rows = (statRows ?? []) as unknown as PlayerMatchStatRow[];

  // Roster para el agregado (nombres desde players_sporting). Cada jugador aparece
  // aunque tenga 0 partidos (invariante de aggregateTeamStats).
  const roster: RosterPlayer[] = tm.map((r) => {
    const sp = spById.get(r.player_id);
    return {
      player_id: r.player_id,
      first_name: sp?.first_name ?? '',
      last_name: sp?.last_name ?? null,
      dorsal_in_team: r.dorsal_in_team,
      position_in_team: r.position_in_team,
    };
  });

  const { perPlayer } = aggregateTeamStats(roster, rows);

  const merged: RosterStatRow[] = perPlayer.map((p) => {
    const sp = spById.get(p.player_id);
    return {
      player_id: p.player_id,
      first_name: p.first_name,
      last_name: p.last_name,
      dorsal: p.dorsal_in_team ?? sp?.dorsal ?? null,
      position: p.position_in_team ?? sp?.position_main ?? null,
      foot: sp?.foot ?? null,
      stats: p.stats,
    };
  });

  // Orden: dorsal asc (sin dorsal al final), luego por nombre.
  merged.sort((a, b) => {
    if (a.dorsal == null && b.dorsal == null) {
      return a.first_name.localeCompare(b.first_name, 'es', {
        sensitivity: 'base',
      });
    }
    if (a.dorsal == null) return 1;
    if (b.dorsal == null) return -1;
    return a.dorsal - b.dorsal;
  });

  return merged;
}
