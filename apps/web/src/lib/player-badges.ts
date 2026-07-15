/**
 * F9.6 / 9.B-5 — Ensamblaje en SERVIDOR de las badges de un jugador.
 *
 * El cálculo vive en core (9.B-4, puro, sin persistir — D6). Aquí solo se
 * cargan los datos y se llama al evaluador. Se reutiliza `loadTeamSeasonStats`
 * (9.B-0) para el contexto del roster (relativas: pichichi, top asistente,
 * mvp_season) y se aportan los datos que el core no calcula:
 *   - avgRating + nº de muestras y matchMvpCount por jugador del roster
 *     (una sola query a `evaluations` por equipo → sin N+1),
 *   - % de asistencia + sesiones del jugador (`training_attendance`),
 *   - serie de titularidades ordenada por `events.starts_at`,
 *   - careerMatches (de `loadPlayerCareer`, 9.B-1) para el veterano.
 *
 * FLAG (D5): `showRating` se computa aquí desde
 * `club_settings.evaluations_player_visibility` y se pasa al evaluador; con OFF
 * el core no emite mvp_match/mvp_season/high_rating.
 *
 * Multi-equipo en la temporada (D2): se evalúa POR EQUIPO (cada uno con su
 * roster) y se hace la UNIÓN de badges del jugador; ante un mismo `kind`
 * duplicado se conserva el de mayor nivel/valor. Las absolutas/relativas se
 * calculan en el contexto correcto de cada equipo.
 */

import {
  attendanceBreakdown,
  evaluateSeasonBadges,
  evaluateCareerBadges,
  type AggregatedStats,
  type AttendanceRow,
  type Badge,
  type SeasonBadgeInput,
  type createSupabaseServerClient,
} from '@misterfc/core';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadTeamSeasonStats } from '@/app/[locale]/(authenticated)/equipos/[teamId]/team-stats-queries';

type Supa = ReturnType<typeof createSupabaseServerClient>;

export interface LoadPlayerBadgesArgs {
  playerId: string;
  clubId: string;
  /** Partidos de carrera (de `loadPlayerCareer(...).totals.stats.matches`, 9.B-1). */
  careerMatches: number;
}

/** Mezcla per-jugador de la query de `evaluations` de un equipo. */
type RatingAgg = { sum: number; count: number; mvp: number };

/** Une badges del jugador entre equipos: ante `kind` repetido, el mejor. */
function unionBest(badges: Badge[]): Badge[] {
  const best = new Map<string, Badge>();
  for (const b of badges) {
    const cur = best.get(b.kind);
    if (
      !cur ||
      (b.level ?? 0) > (cur.level ?? 0) ||
      ((b.level ?? 0) === (cur.level ?? 0) && b.value > cur.value)
    ) {
      best.set(b.kind, b);
    }
  }
  return Array.from(best.values());
}

export async function loadPlayerBadges(
  supabase: Supa,
  { playerId, clubId, careerMatches }: LoadPlayerBadgesArgs
): Promise<Badge[]> {
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  // Equipos del jugador en la temporada activa (un jugador puede estar en varios).
  type TmRow = { team_id: string; teams: { season: string } };
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('team_id, teams!inner(season)')
    .eq('player_id', playerId);
  const teamIds = Array.from(
    new Set(
      ((tmRows ?? []) as unknown as TmRow[])
        .filter((r) => r.teams.season === activeSeason)
        .map((r) => r.team_id)
    )
  );

  // Flag del club (D5). Por defecto OFF (opt-in).
  const { data: settings } = await supabase
    .from('club_settings')
    .select('evaluations_player_visibility')
    .eq('club_id', clubId)
    .maybeSingle();
  const showRating = settings?.evaluations_player_visibility === true;

  // Asistencia del jugador en la temporada (per-jugador, no per-equipo).
  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('code, events!inner(type, teams!inner(season))')
    .eq('player_id', playerId)
    .eq('events.type', 'training')
    // F14F-1b — los badges de asistencia excluyen entrenos cancelados.
    .is('events.cancelled_at', null)
    .eq('events.teams.season', activeSeason);
  const attendance = attendanceBreakdown(
    (attRows ?? []) as unknown as AttendanceRow[]
  );

  // — Badges de temporada por equipo, luego unión —
  const seasonBadges: Badge[] = [];
  for (const teamId of teamIds) {
    const team = await loadTeamSeasonStats(teamId);
    if (!team) continue;

    // Valoraciones del equipo: avgRating + muestras + MVP por jugador (1 query).
    const { data: evalRows } = await supabase
      .from('evaluations')
      .select('player_id, rating, is_mvp')
      .eq('team_id', teamId);
    const ratingByPlayer = new Map<string, RatingAgg>();
    for (const e of (evalRows ?? []) as Array<{
      player_id: string;
      rating: number | null;
      is_mvp: boolean;
    }>) {
      const acc = ratingByPlayer.get(e.player_id) ?? { sum: 0, count: 0, mvp: 0 };
      if (e.rating != null) {
        acc.sum += e.rating;
        acc.count += 1;
      }
      if (e.is_mvp) acc.mvp += 1;
      ratingByPlayer.set(e.player_id, acc);
    }

    // Serie de titularidades del jugador en ESTE equipo, ordenada por fecha.
    const { data: tlRows } = await supabase
      .from('match_player_stats')
      .select('started, events!inner(starts_at)')
      .eq('player_id', playerId)
      .eq('team_id', teamId);
    type TlRow = { started: boolean; events: { starts_at: string } };
    const startedTimeline = ((tlRows ?? []) as unknown as TlRow[])
      .slice()
      .sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at))
      .map((r) => r.started);

    const roster: SeasonBadgeInput[] = team.aggregate.perPlayer.map((p) => {
      const r = ratingByPlayer.get(p.player_id);
      const base: SeasonBadgeInput = {
        playerId: p.player_id,
        stats: p.stats as AggregatedStats,
        matchMvpCount: r?.mvp ?? 0,
        avgRating: r && r.count > 0 ? r.sum / r.count : null,
        ratingCount: r?.count ?? 0,
      };
      // Asistencia y racha solo para el jugador objetivo (las demás son contexto
      // para las relativas: solo necesitan stats + rating).
      if (p.player_id === playerId) {
        return {
          ...base,
          attendancePct: attendance.presentPct,
          attendanceSessions: attendance.total,
          startedTimeline,
        };
      }
      return base;
    });

    const map = evaluateSeasonBadges(roster, { showRating });
    seasonBadges.push(...(map.get(playerId) ?? []));
  }

  const career = evaluateCareerBadges({ careerMatches });
  return [...unionBest(seasonBadges), ...career];
}
