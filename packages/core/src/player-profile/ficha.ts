import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { sumMatchStats, type AggregatedStats, type MatchStatRow } from './aggregate';
import { splitMatchStatsByType, type MatchStatsByType, type MatchStatRowTyped } from './by-type';
import {
  derivedRatios,
  attendanceBreakdown,
  type DerivedRatios,
  type AttendanceBreakdown,
  type AttendanceRow,
} from './derived';
import { ratingTimeline, type RatingTimelinePoint } from './timeline';
import {
  careerBySeason,
  careerTotals,
  type SeasonStatRow,
  type SeasonStats,
  type CareerTotals,
} from './career';

/**
 * O2-5 C1 — Fetch del EXPEDIENTE DEPORTIVO del hijo (Mi ficha, SOLO LECTURA),
 * extraído de `apps/web/.../mi-ficha/page.tsx` (queries inline) y del helper
 * `lib/player-career.ts`. Reutiliza el cálculo puro de core (sumMatchStats,
 * splitMatchStatsByType, derivedRatios, attendanceBreakdown, ratingTimeline,
 * careerBySeason/Totals); solo el FETCH se extrae. Comportamiento idéntico al web.
 *
 * NO incluye BADGES (dependen de loadTeamSeasonStats, superficie de equipo — se
 * evalúa aparte) ni la firma/URL de la FOTO (Storage server-only; C2). La foto se
 * devuelve como `photoPath` para que el caller la firme si procede (web); native
 * usa iniciales.
 */
type DbClient = SupabaseClient<Database>;

// ── Carrera (extraído de lib/player-career.ts) ──────────────────────────────

/** Una temporada de la carrera + su rating medio (para el gráfico de comparación). */
export type CareerSeason = SeasonStats & { rating: number | null };

export interface PlayerCareer {
  bySeason: CareerSeason[];
  totals: CareerTotals;
}

const CAREER_STAT_COLUMNS =
  'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)';

export async function getPlayerCareerFromClient(
  supabase: DbClient,
  playerId: string
): Promise<PlayerCareer> {
  const { data: rawStats } = await supabase
    .from('match_player_stats')
    .select(CAREER_STAT_COLUMNS)
    .eq('player_id', playerId);
  type StatJoin = MatchStatRow & { teams: { season: string } };
  const rows: SeasonStatRow[] = ((rawStats ?? []) as unknown as StatJoin[]).map(
    ({ teams, ...stat }) => ({ ...stat, season: teams.season })
  );

  const { data: rawEvals } = await supabase
    .from('evaluations')
    .select('rating, teams!inner(season)')
    .eq('player_id', playerId);
  type EvalJoin = { rating: number | null; teams: { season: string } };
  const sumBySeason = new Map<string, { sum: number; n: number }>();
  for (const e of (rawEvals ?? []) as unknown as EvalJoin[]) {
    if (e.rating == null) continue;
    const season = e.teams.season;
    const acc = sumBySeason.get(season) ?? { sum: 0, n: 0 };
    acc.sum += e.rating;
    acc.n += 1;
    sumBySeason.set(season, acc);
  }
  const ratingFor = (season: string): number | null => {
    const acc = sumBySeason.get(season);
    return acc && acc.n > 0 ? acc.sum / acc.n : null;
  };

  const bySeason: CareerSeason[] = careerBySeason(rows).map((s) => ({
    ...s,
    rating: ratingFor(s.season),
  }));
  return { bySeason, totals: careerTotals(rows) };
}

// ── Ficha completa ──────────────────────────────────────────────────────────

export type PlayerFichaIdentity = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  dorsal: number | null;
  positionMain: string | null;
  positionsSecondary: string[];
  foot: string | null;
  /** Ruta en Storage (`player-photos`); el caller la firma si procede. null si no hay. */
  photoPath: string | null;
};

export type PlayerMatchEvaluation = {
  eventId: string;
  startsAt: string;
  label: string;
  rating: number | null;
  isMvp: boolean;
  comment: string | null;
  teamRating: number | null;
};

export type PlayerFicha = {
  identity: PlayerFichaIdentity;
  seasons: string[];
  activeSeason: string | null;
  statsByType: MatchStatsByType;
  stats: AggregatedStats;
  ratios: DerivedRatios;
  attendance: AttendanceBreakdown;
  evolution: RatingTimelinePoint[];
  evaluations: PlayerMatchEvaluation[];
  career: PlayerCareer;
};

export async function getPlayerFichaFromClient(
  supabase: DbClient,
  playerId: string,
  opts?: { season?: string | null }
): Promise<PlayerFicha> {
  // 1) Identidad.
  const { data: playerRow } = await supabase
    .from('players')
    .select(
      'first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url'
    )
    .eq('id', playerId)
    .maybeSingle();
  const identity: PlayerFichaIdentity = {
    firstName: playerRow?.first_name ?? null,
    lastName: playerRow?.last_name ?? null,
    dateOfBirth: playerRow?.date_of_birth ?? null,
    dorsal: playerRow?.dorsal ?? null,
    positionMain: playerRow?.position_main ?? null,
    positionsSecondary: (playerRow?.positions_secondary ?? []) as string[],
    foot: playerRow?.foot ?? null,
    photoPath: playerRow?.photo_url ?? null,
  };

  // 2) Temporadas de la trayectoria (selector + default).
  const { data: history } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(season)')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  type HistTeam = { season: string } | null;
  const seasonsSet = new Set<string>();
  let activeSeasonFromHistory: string | null = null;
  for (const h of history ?? []) {
    const tm = (h.teams ?? null) as HistTeam;
    const s = tm?.season;
    if (s) {
      seasonsSet.add(s);
      if (h.left_at === null) activeSeasonFromHistory = s;
    }
  }
  const seasons = Array.from(seasonsSet).sort((a, b) => b.localeCompare(a));
  const requested = opts?.season ?? null;
  const activeSeason =
    (requested && seasons.includes(requested) ? requested : null) ??
    activeSeasonFromHistory ??
    seasons[0] ??
    null;

  // 3) Stats agregadas por tipo (Σ; desglose con splitMatchStatsByType).
  let statsByType: MatchStatsByType = splitMatchStatsByType([]);
  let stats: AggregatedStats = sumMatchStats([]);
  if (activeSeason) {
    const { data: statRows } = await supabase
      .from('match_player_stats')
      .select(
        'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, events!inner(type, tournament_id), teams!inner(season)'
      )
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    type StatRowRaw = MatchStatRow & {
      events: { type: string; tournament_id: string | null };
    };
    const typedRows: MatchStatRowTyped[] = (
      (statRows ?? []) as unknown as StatRowRaw[]
    ).map((r) => ({
      ...r,
      eventType: r.events?.type ?? '',
      tournamentId: r.events?.tournament_id ?? null,
    }));
    statsByType = splitMatchStatsByType(typedRows);
    stats = statsByType.total;
  }

  // 4) Ratios (puro) + asistencia.
  const ratios = derivedRatios(stats);
  let attendance = attendanceBreakdown([]);
  if (activeSeason) {
    const { data: attRows } = await supabase
      .from('training_attendance')
      .select('code, events!inner(type, teams!inner(season))')
      .eq('player_id', playerId)
      .eq('events.type', 'training')
      .is('events.cancelled_at', null)
      .eq('events.teams.season', activeSeason);
    attendance = attendanceBreakdown((attRows ?? []) as unknown as AttendanceRow[]);
  }

  // 5) Evolución + detalle de valoraciones (solo flag ON → la RLS deja eval en 0).
  let evolution: RatingTimelinePoint[] = [];
  let evaluations: PlayerMatchEvaluation[] = [];
  if (activeSeason) {
    const { data: matchRows } = await supabase
      .from('match_player_stats')
      .select(
        'event_id, events!inner(starts_at, opponent_name, title), teams!inner(season)'
      )
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    type MatchRow = {
      event_id: string;
      events: { starts_at: string; opponent_name: string | null; title: string };
    };
    const matches = (matchRows ?? []) as unknown as MatchRow[];
    if (matches.length > 0) {
      const eventIds = matches.map((m) => m.event_id);
      const [{ data: evalRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('evaluations')
          .select('event_id, rating, comment, is_mvp')
          .eq('player_id', playerId)
          .in('event_id', eventIds),
        supabase
          .from('team_evaluations')
          .select('event_id, rating')
          .in('event_id', eventIds),
      ]);
      type EvalRow = {
        event_id: string;
        rating: number | null;
        comment: string | null;
        is_mvp: boolean;
      };
      const ind = new Map<string, EvalRow>();
      for (const r of (evalRows ?? []) as EvalRow[]) ind.set(r.event_id, r);
      const team = new Map<string, number | null>();
      for (const r of (teamRows ?? []) as Array<{ event_id: string; rating: number | null }>) {
        team.set(r.event_id, r.rating);
      }

      evolution = ratingTimeline(
        matches.map((m) => ({
          eventId: m.event_id,
          startsAt: m.events.starts_at,
          label: m.events.opponent_name ?? m.events.title,
          rating: ind.get(m.event_id)?.rating ?? null,
          teamRating: team.get(m.event_id) ?? null,
        }))
      );

      evaluations = matches
        .filter((m) => ind.has(m.event_id))
        .map((m) => {
          const e = ind.get(m.event_id)!;
          return {
            eventId: m.event_id,
            startsAt: m.events.starts_at,
            label: m.events.opponent_name ?? m.events.title,
            rating: e.rating,
            isMvp: e.is_mvp,
            comment: e.comment,
            teamRating: team.get(m.event_id) ?? null,
          };
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
  }

  // 6) Carrera multi-temporada.
  const career = await getPlayerCareerFromClient(supabase, playerId);

  return {
    identity,
    seasons,
    activeSeason,
    statsByType,
    stats,
    ratios,
    attendance,
    evolution,
    evaluations,
    career,
  };
}
