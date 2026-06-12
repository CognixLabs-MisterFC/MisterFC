/**
 * F9.6 / 9.B-4 — Evaluador de BADGES / insignias del jugador (PURO, sin red ni
 * DOM, SIN persistir — D6: se calculan al vuelo desde stats ya existentes).
 *
 * Spec 9.B §3. Dos planos:
 *  - **Relativas al roster** (se autoajustan): pichichi del equipo, top
 *    asistente y MVP de la TEMPORADA (mejor media del equipo). Necesitan el
 *    contexto del equipo → se evalúan sobre el roster que viene de
 *    `aggregateTeamStats` (9.B-0); NO se recalcula nada.
 *  - **Absolutas / por jugador** (umbral fijo): goleador, hombre de hierro,
 *    juego limpio, killer de penaltis, racha de titular (temporada), nota alta y
 *    MVP del PARTIDO (conteo de selecciones del entrenador), y veterano (carrera).
 *
 * MVP en DOS badges distintas (ambas rating-sensibles): `mvp_match` = nº de
 * veces elegido MVP del partido por el entrenador (`evaluations.is_mvp`, la
 * selección REAL, no derivada de la nota); `mvp_season` = mejor media del equipo
 * (relativa, con suelo de muestras). `high_rating` (nota alta absoluta) es otra.
 *
 * Umbrales FIJOS v1 en `BADGE_THRESHOLDS` (D4): nada hardcodeado disperso.
 * Rating-sensibles (mvp_match, mvp_season, high_rating): el evaluador recibe
 * `showRating`; con OFF NO se emiten (D5). El server le pasa el flag del club
 * (`club_settings.evaluations_player_visibility`).
 *
 * No se inventan datos: cada badge se computa de columnas reales de
 * `match_player_stats` o de un dato que el server aporta de su tabla real
 * (`evaluations` para MVP/nota; `training_attendance` para asistencia; el orden
 * cronológico de titularidades vía `events.starts_at`). Ver el README de la PR
 * para las badges APLAZADAS.
 */

import type { AggregatedStats } from './aggregate';

// ─────────────────────────────────────────────────────────────────────────────
// Umbrales fijos v1 (D4). Documentados; revisar por categoría en el futuro.
// ─────────────────────────────────────────────────────────────────────────────

export const BADGE_THRESHOLDS = {
  /** Goleador de la temporada: goles ≥ … */
  TOP_SCORER_GOALS: 10,
  /** Hombre de hierro: partidos jugados en la temporada ≥ … (regularidad). */
  IRON_MAN_MATCHES: 15,
  /** Racha de titular: titularidades CONSECUTIVAS ≥ … */
  STARTER_STREAK_MIN: 5,
  /** Killer de penaltis: intentos mínimos y % de acierto mínimo. */
  PENALTY_KILLER_MIN_ATTEMPTS: 3,
  PENALTY_KILLER_MIN_RATE: 0.8,
  /**
   * Nota alta: media ≥ … con un mínimo de valoraciones. El mínimo de muestras
   * (`HIGH_RATING_MIN_SAMPLE`) lo reutiliza también la MVP de temporada (mejor
   * media del equipo) como suelo, para que una única valoración alta no gane.
   */
  HIGH_RATING_MIN: 7.5,
  HIGH_RATING_MIN_SAMPLE: 5,
  /** Juego limpio: 0 rojas y amarillas/partido ≤ … con un mínimo de partidos. */
  CLEAN_PLAY_MIN_MATCHES: 5,
  CLEAN_PLAY_MAX_YELLOWS_PER_MATCH: 0.25,
  /** Asistencia perfecta: 100% de presencia con un mínimo de sesiones. */
  PERFECT_ATTENDANCE_MIN_SESSIONS: 5,
  /** Pichichi / top asistente del equipo: el líder debe alcanzar al menos … */
  TOP_TEAM_MIN: 1,
  /**
   * MVP del PARTIDO (selección real del entrenador, `evaluations.is_mvp`):
   * nivel 1/2/3 según el nº de veces elegido MVP (≥1, ≥3, ≥5). NO se deriva de
   * la nota. La MVP de TEMPORADA es otra badge (mejor media del equipo, relativa).
   */
  MVP_MATCH_LEVELS: [1, 3, 5],
  /** Veterano: nivel 1/2/3 según partidos de carrera (50/100/200). */
  VETERAN_LEVELS: [50, 100, 200],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type BadgeKind =
  // Relativas al roster (temporada)
  | 'top_scorer_team'
  | 'top_assister_team'
  // Por jugador (temporada)
  | 'top_scorer'
  | 'iron_man'
  | 'clean_play'
  | 'penalty_killer'
  | 'starter_streak'
  | 'perfect_attendance'
  // Rating-sensibles (temporada)
  | 'mvp_match' // MVP del partido (conteo de selecciones del entrenador)
  | 'mvp_season' // MVP de la temporada (mejor media del equipo, relativa)
  | 'high_rating'
  // Carrera
  | 'veteran';

export type BadgeScope = 'season' | 'career';

export interface Badge {
  kind: BadgeKind;
  scope: BadgeScope;
  /** Valor que la otorga (goles, partidos, racha, nota media…) — para la UI. */
  value: number;
  /** Nivel para badges escalonadas (mvp_match 1/2/3, veteran 1/2/3). */
  level?: number;
}

export interface BadgeOptions {
  /**
   * Flag del club (`club_settings.evaluations_player_visibility`). Con OFF NO se
   * emiten badges derivadas de valoraciones (MVP del partido, MVP de temporada,
   * nota alta) — D5.
   */
  showRating: boolean;
}

/** Datos de un jugador para evaluar sus badges de temporada. */
export interface SeasonBadgeInput {
  playerId: string;
  /** Totales de la temporada (de `aggregateTeamStats(...).perPlayer[i].stats`). */
  stats: AggregatedStats;
  /**
   * Nº de veces que el ENTRENADOR lo eligió MVP del partido (`evaluations.is_mvp`,
   * único por evento) — la selección REAL, no derivada de la nota. Rating-sensible;
   * omitir → sin MVP del partido.
   */
  matchMvpCount?: number;
  /** Nota media de la temporada (`evaluations.rating`) — rating-sensible. */
  avgRating?: number | null;
  /** Nº de valoraciones (muestra mínima para "nota alta" y "MVP de temporada"). */
  ratingCount?: number;
  /** % de presencia a entrenos en 0..1 (`training_attendance`). */
  attendancePct?: number | null;
  /** Nº de sesiones de entreno consideradas (muestra mínima). */
  attendanceSessions?: number;
  /**
   * Titularidades por partido en orden CRONOLÓGICO ascendente (el server ordena
   * por `events.starts_at`; `match_player_stats` no tiene fecha). Para la racha.
   * Omitir → no se evalúa la racha.
   */
  startedTimeline?: readonly boolean[];
}

/** Datos de carrera de un jugador (de `careerTotals(...).stats` en 9.B-1). */
export interface CareerBadgeInput {
  /** Partidos totales de carrera (todas las temporadas). */
  careerMatches: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/** Nivel (1..n) = índice más alto cuyo umbral ≤ value; null si no alcanza ninguno. */
function levelFor(value: number, thresholds: readonly number[]): number | null {
  let level: number | null = null;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]!) level = i + 1;
  }
  return level;
}

/** Racha máxima de `true` consecutivos en la serie. */
function longestStreak(timeline: readonly boolean[]): number {
  let best = 0;
  let run = 0;
  for (const started of timeline) {
    run = started ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluadores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Badges de TEMPORADA para todos los jugadores del roster. Las relativas
 * (pichichi, top asistente) se calculan sobre el máximo del roster con empates
 * resueltos de forma explícita: TODOS los líderes empatados reciben la badge.
 * Devuelve un `Map playerId → Badge[]` (jugadores sin badges no aparecen).
 */
export function evaluateSeasonBadges(
  roster: readonly SeasonBadgeInput[],
  opts: BadgeOptions
): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  const push = (playerId: string, badge: Badge) => {
    const list = out.get(playerId);
    if (list) list.push(badge);
    else out.set(playerId, [badge]);
  };

  const T = BADGE_THRESHOLDS;

  // — Relativas: líderes del roster (empates incluidos) —
  const maxGoals = roster.reduce((m, p) => Math.max(m, p.stats.goals), 0);
  const maxAssists = roster.reduce((m, p) => Math.max(m, p.stats.assists), 0);

  for (const p of roster) {
    if (maxGoals >= T.TOP_TEAM_MIN && p.stats.goals === maxGoals) {
      push(p.playerId, {
        kind: 'top_scorer_team',
        scope: 'season',
        value: p.stats.goals,
      });
    }
    if (maxAssists >= T.TOP_TEAM_MIN && p.stats.assists === maxAssists) {
      push(p.playerId, {
        kind: 'top_assister_team',
        scope: 'season',
        value: p.stats.assists,
      });
    }
  }

  // MVP de la temporada (RELATIVA, rating-sensible): el de mayor media de su
  // equipo, con suelo de muestras (≥ HIGH_RATING_MIN_SAMPLE) para que una sola
  // valoración alta no gane. Empates → todos los líderes. Sin valoraciones (o
  // nadie alcanza el suelo) → nadie. Solo con el flag ON (D5).
  if (opts.showRating) {
    const eligible = roster.filter(
      (p) =>
        p.avgRating != null &&
        (p.ratingCount ?? 0) >= T.HIGH_RATING_MIN_SAMPLE
    );
    if (eligible.length > 0) {
      const maxAvg = eligible.reduce(
        (m, p) => Math.max(m, p.avgRating as number),
        -Infinity
      );
      for (const p of eligible) {
        if ((p.avgRating as number) === maxAvg) {
          push(p.playerId, {
            kind: 'mvp_season',
            scope: 'season',
            value: p.avgRating as number,
          });
        }
      }
    }
  }

  // — Por jugador —
  for (const p of roster) {
    const s = p.stats;

    // Goleador de la temporada (umbral absoluto).
    if (s.goals >= T.TOP_SCORER_GOALS) {
      push(p.playerId, { kind: 'top_scorer', scope: 'season', value: s.goals });
    }

    // Hombre de hierro (regularidad).
    if (s.matches >= T.IRON_MAN_MATCHES) {
      push(p.playerId, { kind: 'iron_man', scope: 'season', value: s.matches });
    }

    // Juego limpio: 0 rojas y pocas amarillas por partido, con muestra mínima.
    if (
      s.matches >= T.CLEAN_PLAY_MIN_MATCHES &&
      s.redCards === 0 &&
      s.yellowCards / s.matches <= T.CLEAN_PLAY_MAX_YELLOWS_PER_MATCH
    ) {
      push(p.playerId, {
        kind: 'clean_play',
        scope: 'season',
        value: s.yellowCards,
      });
    }

    // Killer de penaltis: ≥N intentos y % de acierto alto.
    const attempts = s.penaltiesScored + s.penaltiesMissed;
    if (
      attempts >= T.PENALTY_KILLER_MIN_ATTEMPTS &&
      s.penaltiesScored / attempts >= T.PENALTY_KILLER_MIN_RATE
    ) {
      push(p.playerId, {
        kind: 'penalty_killer',
        scope: 'season',
        value: s.penaltiesScored,
      });
    }

    // Racha de titular: titularidades consecutivas (necesita la serie ordenada).
    if (p.startedTimeline && p.startedTimeline.length > 0) {
      const streak = longestStreak(p.startedTimeline);
      if (streak >= T.STARTER_STREAK_MIN) {
        push(p.playerId, {
          kind: 'starter_streak',
          scope: 'season',
          value: streak,
        });
      }
    }

    // Asistencia perfecta: 100% de presencia con un mínimo de sesiones.
    if (
      p.attendancePct != null &&
      (p.attendanceSessions ?? 0) >= T.PERFECT_ATTENDANCE_MIN_SESSIONS &&
      p.attendancePct >= 1
    ) {
      push(p.playerId, {
        kind: 'perfect_attendance',
        scope: 'season',
        value: p.attendanceSessions ?? 0,
      });
    }

    // — Rating-sensibles (solo con el flag del club ON, D5) —
    if (opts.showRating) {
      // MVP del PARTIDO: nº de selecciones del entrenador (is_mvp), nivel por nº.
      if (p.matchMvpCount != null && p.matchMvpCount >= 1) {
        const level = levelFor(p.matchMvpCount, T.MVP_MATCH_LEVELS) ?? 1;
        push(p.playerId, {
          kind: 'mvp_match',
          scope: 'season',
          value: p.matchMvpCount,
          level,
        });
      }
      // Nota alta: media ≥ umbral con muestra mínima (ABSOLUTA, distinta de la
      // MVP de temporada que es relativa).
      if (
        p.avgRating != null &&
        (p.ratingCount ?? 0) >= T.HIGH_RATING_MIN_SAMPLE &&
        p.avgRating >= T.HIGH_RATING_MIN
      ) {
        push(p.playerId, {
          kind: 'high_rating',
          scope: 'season',
          value: p.avgRating,
        });
      }
    }
  }

  return out;
}

/**
 * Badges de CARRERA de un jugador. v1: veterano por partidos totales (50/100/200,
 * nivel 1/2/3). Per-jugador, no necesita roster.
 */
export function evaluateCareerBadges(input: CareerBadgeInput): Badge[] {
  const badges: Badge[] = [];
  const level = levelFor(input.careerMatches, BADGE_THRESHOLDS.VETERAN_LEVELS);
  if (level != null) {
    badges.push({
      kind: 'veteran',
      scope: 'career',
      value: input.careerMatches,
      level,
    });
  }
  return badges;
}
