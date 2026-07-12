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
  splitMatchStatsByType,
  aggregateTeamEventsByType,
  classifyMatchType,
  createSupabaseServerClient,
  type RosterPlayer,
  type PlayerMatchStatRow,
  type MatchStatRowTyped,
  type MatchStatsByType,
  type TeamEventRow,
  type TeamEventsAggregate,
  type TeamAggregate,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadSportingNames } from '@/lib/spectator-names';

/** Nº de PARTIDOS REALES del equipo por tipo (count distinct event_id, no Σ apariciones). */
export interface TeamMatchesByType {
  total: number;
  oficial: number;
  amistoso: number;
  torneo: number;
}

/** Goles del EQUIPO por tipo (Σ match_state.goals_for). */
export interface TeamGoalsByType {
  total: number;
  oficial: number;
  amistoso: number;
  torneo: number;
}

/**
 * F9B-4a/4b — totales del EQUIPO desglosados por tipo (Amistoso/Torneo/Oficial/Total).
 * `stats` = métricas summables (Σ match_player_stats) por tipo (helper común
 * splitMatchStatsByType). `matches` = partidos reales (distinct event_id) por tipo.
 * `events` (4b) = conteos de match_events por tipo (corners/offsides/faltas…) +
 * total del rival. `goalsFor` (4b) = goles a favor del marcador por tipo;
 * `goalsAgainst` = goles en contra (columna Rival).
 */
export interface TeamStatsByType {
  stats: MatchStatsByType;
  matches: TeamMatchesByType;
  events: TeamEventsAggregate;
  goalsFor: TeamGoalsByType;
  goalsAgainst: number;
}

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
  byType: TeamStatsByType;
}

/**
 * Devuelve la cabecera del equipo + el agregado de stats de su temporada.
 * `null` si el equipo no existe o no es visible para el usuario (RLS). El
 * agregado se calcula en core (`aggregateTeamStats`).
 */
export async function loadTeamSeasonStats(
  teamId: string,
  opts?: { viewerIsSpectator?: boolean }
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
  let roster: RosterPlayer[];
  if (opts?.viewerIsSpectator) {
    // F14C-4b — el SEGUIDOR no lee `players` (RLS cerrada); team_members SÍ es
    // legible (F14C-3). Los nombres/dorsal salen de `players_sporting` (vista
    // deportiva), NO de players!inner (que devolvería 0 filas → roster vacío).
    const { data: tmOnly } = await supabase
      .from('team_members')
      .select('player_id, dorsal_in_team, position_in_team')
      .eq('team_id', teamId)
      .order('dorsal_in_team', { ascending: true, nullsFirst: false });
    const tmRows = tmOnly ?? [];
    const names = await loadSportingNames(
      supabase,
      tmRows.map((r) => r.player_id)
    );
    roster = tmRows.map((r) => {
      const n = names.get(r.player_id);
      return {
        player_id: r.player_id,
        first_name: n?.first_name ?? '',
        last_name: n?.last_name ?? null,
        dorsal_in_team: r.dorsal_in_team,
        position_in_team: r.position_in_team,
      };
    });
  } else {
    // Ruta de MIEMBRO (sin cambios): nombres desde players!inner.
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

    roster = ((rawRoster ?? []) as unknown as TmRow[]).map((r) => ({
      player_id: r.player_id,
      first_name: r.players.first_name,
      last_name: r.players.last_name,
      dorsal_in_team: r.dorsal_in_team,
      position_in_team: r.position_in_team,
    }));
  }

  // 3) match_player_stats del equipo (RLS: staff del team / admin / coord).
  // F9B-4a — se junta events!inner(type, tournament_id) para el desglose por tipo.
  const { data: rawStats } = await supabase
    .from('match_player_stats')
    .select(
      'player_id, event_id, started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, events!inner(type, tournament_id)'
    )
    .eq('team_id', teamId);

  type RawRow = PlayerMatchStatRow & {
    event_id: string;
    events: { type: string; tournament_id: string | null };
  };
  const raw = (rawStats ?? []) as unknown as RawRow[];

  // Agregado por jugador + totales (invariante existente): usa solo las columnas de
  // match_player_stats (los extras event_id/events se ignoran).
  const rows: PlayerMatchStatRow[] = raw;

  // F9B-4a — desglose por tipo de las métricas summables (Σ de todas las filas del
  // equipo, sobre todos los jugadores) con el MISMO helper que jugador/informe.
  const typedRows: MatchStatRowTyped[] = raw.map((r) => ({
    ...r,
    eventType: r.events?.type ?? '',
    tournamentId: r.events?.tournament_id ?? null,
  }));
  const statsByType = splitMatchStatsByType(typedRows);

  // Partidos REALES por tipo = count(distinct event_id) por grupo (no Σ apariciones).
  // Misma regla de clasificación (classifyMatchType, F9B-1) que el resto del desglose.
  const evByGroup = {
    total: new Set<string>(),
    oficial: new Set<string>(),
    amistoso: new Set<string>(),
    torneo: new Set<string>(),
  };
  for (const r of raw) {
    const group = classifyMatchType(
      r.events?.type ?? '',
      r.events?.tournament_id ?? null,
    );
    if (!group) continue;
    evByGroup[group].add(r.event_id);
    evByGroup.total.add(r.event_id);
  }
  const matchesByType: TeamMatchesByType = {
    total: evByGroup.total.size,
    oficial: evByGroup.oficial.size,
    amistoso: evByGroup.amistoso.size,
    torneo: evByGroup.torneo.size,
  };

  // 4) F9B-4b — eventos de equipo (match_events) del equipo/temporada: corners,
  // fueras de juego, faltas… (no están en match_player_stats). own + rival. Se
  // filtra por el equipo del evento padre; RLS = user_can_record_match (staff).
  const { data: rawEvents } = await supabase
    .from('match_events')
    .select('side, type, events!inner(team_id, type, tournament_id)')
    .eq('events.team_id', teamId);
  type EvRow = {
    side: 'own' | 'rival';
    type: string;
    events: { type: string; tournament_id: string | null };
  };
  const teamEventRows: TeamEventRow[] = (
    (rawEvents ?? []) as unknown as EvRow[]
  ).map((r) => ({
    side: r.side,
    kind: r.type,
    eventType: r.events?.type ?? '',
    tournamentId: r.events?.tournament_id ?? null,
  }));
  const events = aggregateTeamEventsByType(teamEventRows);

  // 5) F9B-4b — marcador (match_state) del equipo/temporada: goles a favor por
  // tipo (fila Goles del equipo, NO la Σ de goles de jugador) + goles en contra
  // (columna Rival). Misma regla de clasificación.
  const { data: rawState } = await supabase
    .from('match_state')
    .select('goals_for, goals_against, events!inner(team_id, type, tournament_id)')
    .eq('events.team_id', teamId);
  type StRow = {
    goals_for: number | null;
    goals_against: number | null;
    events: { type: string; tournament_id: string | null };
  };
  const goalsFor: TeamGoalsByType = {
    total: 0,
    oficial: 0,
    amistoso: 0,
    torneo: 0,
  };
  let goalsAgainst = 0;
  for (const s of (rawState ?? []) as unknown as StRow[]) {
    const group = classifyMatchType(
      s.events?.type ?? '',
      s.events?.tournament_id ?? null,
    );
    if (!group) continue;
    const gf = s.goals_for ?? 0;
    goalsFor[group] += gf;
    goalsFor.total += gf;
    goalsAgainst += s.goals_against ?? 0;
  }

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
    byType: {
      stats: statsByType,
      matches: matchesByType,
      events,
      goalsFor,
      goalsAgainst,
    },
  };
}
