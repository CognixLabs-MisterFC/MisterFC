/**
 * F9.1 — Agregación de estadísticas de PARTIDO por jugador (PURO, sin red ni DOM).
 *
 * Spec 9.0 §4 (agregación por query directa) y §5 (9.1): el server lee las filas de
 * `match_player_stats` del jugador acotadas por temporada (una fila por partido
 * cerrado en que participó) y se las pasa a `sumMatchStats`, que devuelve los totales
 * + los conteos (`matches`, `starts`). Aquí NO hay acceso a BD: solo se suma, así se
 * testea con Vitest sin DOM ni Supabase.
 *
 * Las stats DERIVADAS (ratios goles/partido, %titularidad…), el desglose de
 * asistencia y la evolución son 9.2/9.3 — fuera de este helper.
 */

/** Proyección de una fila de `match_player_stats` relevante para el sumatorio. */
export interface MatchStatRow {
  started: boolean;
  minutes_played: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  shots: number;
  fouls_committed: number;
  fouls_received: number;
  penalties_scored: number;
  penalties_missed: number;
}

/** Totales de la temporada para un jugador (SUM de `match_player_stats`). */
export interface AggregatedStats {
  /** nº de partidos con fila de stats (jugó / quedó registrado al cerrar el partido). */
  matches: number;
  /** nº de titularidades (`started = true`). */
  starts: number;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  shots: number;
  foulsCommitted: number;
  foulsReceived: number;
  penaltiesScored: number;
  penaltiesMissed: number;
}

/** Acumulador a cero (también es el resultado para 0 partidos). */
export function emptyAggregatedStats(): AggregatedStats {
  return {
    matches: 0,
    starts: 0,
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    shots: 0,
    foulsCommitted: 0,
    foulsReceived: 0,
    penaltiesScored: 0,
    penaltiesMissed: 0,
  };
}

/**
 * SUM por jugador de las filas de `match_player_stats` ya leídas (de una temporada).
 * `matches` = nº de filas; `starts` = filas con `started`. Orden irrelevante.
 */
export function sumMatchStats(rows: readonly MatchStatRow[]): AggregatedStats {
  const acc = emptyAggregatedStats();
  for (const r of rows) {
    acc.matches += 1;
    if (r.started) acc.starts += 1;
    acc.minutesPlayed += r.minutes_played;
    acc.goals += r.goals;
    acc.assists += r.assists;
    acc.yellowCards += r.yellow_cards;
    acc.redCards += r.red_cards;
    acc.shots += r.shots;
    acc.foulsCommitted += r.fouls_committed;
    acc.foulsReceived += r.fouls_received;
    acc.penaltiesScored += r.penalties_scored;
    acc.penaltiesMissed += r.penalties_missed;
  }
  return acc;
}
