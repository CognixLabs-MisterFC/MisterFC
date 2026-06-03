/**
 * F7.8 — Tiempo de juego y stats por jugador EN VIVO (PURO, sin DOM ni red).
 *
 * Spec 7.0 §6: el minuto de marcador NO basta para sumar minutos jugados con
 * descanso, prórroga y cambios. El cálculo se hace sobre `clock_seconds` ABSOLUTO
 * (segundos de juego desde el pitido inicial, monótono no decreciente, el
 * descanso no cuenta — ver `clockSecondsAt` en clock.ts). Por eso aquí solo
 * restamos instantes de reloj: el descanso, la prórroga y los límites de periodo
 * ya están plegados en esos números; no necesitamos los periodos aquí.
 *
 *   minutos(jugador) = Σ (instante_salida − instante_entrada) sobre los tramos
 *   en campo, donde:
 *     - entrada ∈ { pitido inicial (clock 0) si era titular (match_starters);
 *                   `substitution` cuyo `related_player_id` = jugador };
 *     - salida  ∈ { `substitution` cuyo `player_id` = jugador; `red_card` del
 *                   jugador; el reloj ACTUAL si sigue en el campo (tramo abierto) }.
 *
 * Un titular cuenta desde 0; un suplente desde su entrada; las reentradas
 * (cambios corridos) suman varios tramos; un expulsado deja de sumar en su roja;
 * un AUSENTE = 0. Es una vista CALCULADA: NO materializa nada (eso es el cierre
 * 7.10, que reusa este motor). Vive y se testea sin DOM (§15).
 */

/**
 * Proyección mínima de una fila de `match_events` (side='own') relevante para el
 * cálculo. Solo `substitution` y `red_card` afectan a los minutos; las
 * tarjetas/goles/asistencias se cuentan. El resto de tipos se ignoran.
 */
export interface MatchEventLite {
  type: string;
  /** Actor: en `substitution` = el que SALE; en gol/tarjeta/etc = el jugador. */
  playerId: string | null;
  /** En `substitution` = el que ENTRA (`related_player_id`). */
  relatedPlayerId?: string | null;
  /** Segundos absolutos de juego del evento (§6). */
  clockSeconds: number;
}

export interface PlayingTimeInput {
  /** Once inicial congelado al pitido (match_starters): entran en clock 0. */
  starterIds: readonly string[];
  /** Eventos propios del partido (cualquier tipo); orden indiferente. */
  events: readonly MatchEventLite[];
  /** Reloj absoluto AHORA (`clockSecondsAt(periods, now)`): cierra los tramos abiertos. */
  matchClockSeconds: number;
  /** Ausentes ("no vienen", match_absences): siempre 0 min, no entran nunca. */
  absentIds?: Iterable<string>;
}

/** Una transición de un jugador entre dentro/fuera del campo, en clock_seconds. */
interface Transition {
  clockSeconds: number;
  kind: 'in' | 'out';
  /** Orden de inserción, para desempatar transiciones al mismo segundo de forma estable. */
  seq: number;
}

/**
 * Segundos jugados por jugador (mapa playerId → segundos en campo). Pura: solo
 * resta instantes de reloj, robusta ante descanso/prórroga (ya plegados en
 * `clock_seconds`). Los ausentes quedan en 0 (no se incluyen).
 */
export function computePlayingSeconds(
  input: PlayingTimeInput,
): Map<string, number> {
  const absent = new Set(input.absentIds ?? []);
  const transitions = new Map<string, Transition[]>();
  let seq = 0;

  const push = (playerId: string | null, kind: 'in' | 'out', clockSeconds: number) => {
    if (!playerId || absent.has(playerId)) return;
    const arr = transitions.get(playerId);
    const tr: Transition = { clockSeconds, kind, seq: seq++ };
    if (arr) arr.push(tr);
    else transitions.set(playerId, [tr]);
  };

  // Titulares: entran en el pitido inicial (clock 0).
  for (const id of input.starterIds) push(id, 'in', 0);

  // Entradas/salidas desde los eventos. Solo substitution y red_card mueven a un
  // jugador dentro/fuera; el resto no afecta a los minutos.
  for (const ev of input.events) {
    if (ev.type === 'substitution') {
      push(ev.playerId, 'out', ev.clockSeconds);
      push(ev.relatedPlayerId ?? null, 'in', ev.clockSeconds);
    } else if (ev.type === 'red_card') {
      push(ev.playerId, 'out', ev.clockSeconds);
    }
  }

  const seconds = new Map<string, number>();
  for (const [playerId, trs] of transitions) {
    // Orden cronológico; a igual segundo, respeta el orden de inserción (las
    // salidas se registran antes que la entrada del mismo cambio).
    trs.sort((a, b) => a.clockSeconds - b.clockSeconds || a.seq - b.seq);

    let total = 0;
    let onField = false;
    let entry = 0;
    for (const tr of trs) {
      if (tr.kind === 'in') {
        if (!onField) {
          onField = true;
          entry = tr.clockSeconds;
        }
      } else if (onField) {
        total += Math.max(0, tr.clockSeconds - entry);
        onField = false;
      }
    }
    // Tramo abierto: sigue en el campo hasta el reloj actual.
    if (onField) total += Math.max(0, input.matchClockSeconds - entry);
    seconds.set(playerId, total);
  }

  return seconds;
}

export interface PlayerEventCounts {
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

/** Cuenta goles/asistencias/tarjetas por jugador desde los eventos (side='own'). */
export function countPlayerEvents(
  events: readonly { type: string; playerId: string | null }[],
): Map<string, PlayerEventCounts> {
  const counts = new Map<string, PlayerEventCounts>();
  const bump = (playerId: string, key: keyof PlayerEventCounts) => {
    const c =
      counts.get(playerId) ??
      { goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
    c[key] += 1;
    counts.set(playerId, c);
  };
  for (const e of events) {
    if (!e.playerId) continue;
    if (e.type === 'goal') bump(e.playerId, 'goals');
    else if (e.type === 'assist') bump(e.playerId, 'assists');
    else if (e.type === 'yellow_card') bump(e.playerId, 'yellowCards');
    else if (e.type === 'red_card') bump(e.playerId, 'redCards');
  }
  return counts;
}

export interface PlayerMatchStats {
  playerId: string;
  playedSeconds: number;
  /** Minutos enteros jugados (floor de los segundos) — la cifra que se muestra. */
  playedMinutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

/**
 * Tabla de stats por jugador (minutos + goles/asistencias/tarjetas), una fila por
 * `rosterId` y en ese orden. Los jugadores sin minutos ni eventos aparecen en 0
 * (p.ej. suplentes sin estrenar) — la tabla muestra TODO el convocado.
 */
export function computePlayerMatchStats(
  input: PlayingTimeInput & { rosterIds: readonly string[] },
): PlayerMatchStats[] {
  const seconds = computePlayingSeconds(input);
  const counts = countPlayerEvents(input.events);
  const zero: PlayerEventCounts = { goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
  return input.rosterIds.map((playerId) => {
    const playedSeconds = seconds.get(playerId) ?? 0;
    const c = counts.get(playerId) ?? zero;
    return {
      playerId,
      playedSeconds,
      playedMinutes: Math.floor(playedSeconds / 60),
      goals: c.goals,
      assists: c.assists,
      yellowCards: c.yellowCards,
      redCards: c.redCards,
    };
  });
}

/**
 * "Ha jugado poco" (§8, 7.8): jugadores por debajo del `thresholdPct` % del
 * tiempo de juego transcurrido (`matchClockSeconds`). Con el reloj a 0 (partido
 * sin empezar) no marca a nadie. Útil para repartir minutos.
 */
export function flagLowPlaytime(
  rows: readonly { playerId: string; playedSeconds: number }[],
  matchClockSeconds: number,
  thresholdPct: number,
): Set<string> {
  const low = new Set<string>();
  if (matchClockSeconds <= 0) return low;
  const limit = (thresholdPct / 100) * matchClockSeconds;
  for (const r of rows) {
    if (r.playedSeconds < limit) low.add(r.playerId);
  }
  return low;
}

/**
 * Los `n` jugadores con MENOS minutos (destacar los menos jugados, §8). Desempata
 * de forma estable por el orden de entrada. `n <= 0` → conjunto vacío.
 */
export function leastPlayedIds(
  rows: readonly { playerId: string; playedSeconds: number }[],
  n: number,
): Set<string> {
  if (n <= 0) return new Set();
  const sorted = rows
    .map((r, index) => ({ ...r, index }))
    .sort((a, b) => a.playedSeconds - b.playedSeconds || a.index - b.index);
  return new Set(sorted.slice(0, n).map((r) => r.playerId));
}
