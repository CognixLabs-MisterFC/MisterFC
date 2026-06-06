/**
 * F7.10 — Cierre y consolidación del partido (PURO, sin DOM ni red).
 *
 * Al FINALIZAR (estado 'closed', §7.7b/7.7c), se MATERIALIZA una fila por jugador
 * propio que participó en `match_player_stats`, más el marcador final (y la tanda
 * si la hubo). Este módulo produce esos valores REUSANDO los motores que ya
 * derivan todo en vivo — NO recalcula con lógica nueva:
 *
 *  - minutos, goles, asistencias, amarillas, rojas → `computePlayerMatchStats`
 *    (7.8; el penalti marcado ya cuenta como gol vía `isMatchGoal`/`countPlayerEvents`).
 *  - faltas cometidas / recibidas → `foulsByPlayer` / `foulsReceivedByPlayer` (7.4b).
 *  - marcador del partido y tanda → `computeScore` / `computeShootout` (7.7c).
 *
 * Es determinista y deriva solo de los eventos: re-cerrar tras editar (línea de
 * tiempo 7.9) recalcula y sobrescribe consistentemente (la capa de aplicación hace
 * delete+reinsert de la cara del partido, §5.3). Vive y se testea sin DOM (§15).
 */

import { computePlayerMatchStats } from './playing-time';
import {
  computeScore,
  computeShootout,
  type ScoreEvent,
  type Side,
} from './score';
import { foulsByPlayer, foulsReceivedByPlayer, type TeamEventLite } from './team-events';

/** Proyección de un `match_event` (cualquier bando/tipo) para consolidar. */
export interface ConsolidationEvent {
  side: Side;
  type: string;
  /** Actor propio (en `substitution` = el que SALE). */
  playerId?: string | null;
  /** En `substitution` = el que ENTRA (`related_player_id`). */
  relatedPlayerId?: string | null;
  clockSeconds: number;
  /** `metadata.outcome` (penalti / tanda). */
  outcome?: string | null;
  /** `metadata.foul_kind` (falta: committed/received). */
  foulKind?: string | null;
}

/** Totales consolidados de UN jugador propio (espejo de `match_player_stats`). */
export interface ConsolidatedPlayerStat {
  playerId: string;
  started: boolean;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  shots: number;
  foulsCommitted: number;
  foulsReceived: number;
  /** Penaltis del partido marcados por el jugador (ya contados también en `goals`). */
  penaltiesScored: number;
  /** Penaltis del partido fallados (parados o fuera). */
  penaltiesMissed: number;
}

export interface MatchConsolidation {
  players: ConsolidatedPlayerStat[];
  /** Marcador del partido (goles + penaltis marcados; la tanda no). */
  score: { own: number; rival: number };
  /** Resultado de la tanda, o `null` si no hubo desempate por penaltis. */
  shootout: { own: number; rival: number; leader: Side | null } | null;
}

export interface ConsolidationInput {
  /** Once inicial congelado (match_starters): entran en clock 0. */
  starterIds: readonly string[];
  /** TODOS los eventos del partido (propios y rival). */
  events: readonly ConsolidationEvent[];
  /** Reloj absoluto final (`clockSecondsAt(periods, now)`): cierra los tramos. */
  matchClockSeconds: number;
  /** Ausentes (match_absences): 0 minutos. */
  absentIds?: readonly string[];
  /** Jugadores propios a materializar (los que participaron). En ese orden. */
  rosterIds: readonly string[];
}

/**
 * Consolida el partido: una fila por `rosterId` (totales derivados) + marcador
 * final + tanda. Determinista a partir de los eventos (re-cerrar sobrescribe con
 * los mismos valores si nada cambió; con ediciones, con los nuevos).
 */
export function consolidateMatch(input: ConsolidationInput): MatchConsolidation {
  const ownEvents = input.events.filter((e) => e.side === 'own');

  // 7.8 — minutos + goles/asistencias/tarjetas (idénticos a la tabla en vivo).
  const base = computePlayerMatchStats({
    starterIds: input.starterIds,
    events: ownEvents.map((e) => ({
      type: e.type,
      playerId: e.playerId ?? null,
      relatedPlayerId: e.relatedPlayerId ?? null,
      clockSeconds: e.clockSeconds,
      outcome: e.outcome ?? null,
    })),
    matchClockSeconds: input.matchClockSeconds,
    absentIds: input.absentIds,
    rosterIds: input.rosterIds,
  });

  // 7.4b — faltas cometidas / recibidas por jugador.
  const teamLite: TeamEventLite[] = ownEvents.map((e) => ({
    type: e.type,
    playerId: e.playerId ?? null,
    foulKind: e.foulKind ?? null,
  }));
  const committed = foulsByPlayer(teamLite);
  const received = foulsReceivedByPlayer(teamLite);

  // Tiros + penaltis por jugador (los marcados ya están en `goals`, 7.8).
  const shots = new Map<string, number>();
  const pkScored = new Map<string, number>();
  const pkMissed = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const e of ownEvents) {
    if (!e.playerId) continue;
    if (e.type === 'shot') bump(shots, e.playerId);
    else if (e.type === 'penalty') {
      if (e.outcome === 'scored') bump(pkScored, e.playerId);
      else bump(pkMissed, e.playerId); // parado o fuera
    }
  }

  const starters = new Set(input.starterIds);
  const players: ConsolidatedPlayerStat[] = base.map((r) => ({
    playerId: r.playerId,
    started: starters.has(r.playerId),
    minutesPlayed: r.playedMinutes,
    goals: r.goals,
    assists: r.assists,
    yellowCards: r.yellowCards,
    redCards: r.redCards,
    shots: shots.get(r.playerId) ?? 0,
    foulsCommitted: committed.get(r.playerId) ?? 0,
    foulsReceived: received.get(r.playerId) ?? 0,
    penaltiesScored: pkScored.get(r.playerId) ?? 0,
    penaltiesMissed: pkMissed.get(r.playerId) ?? 0,
  }));

  const scoreEvents: ScoreEvent[] = input.events.map((e) => ({
    side: e.side,
    type: e.type,
    outcome: e.outcome ?? null,
  }));
  const score = computeScore(scoreEvents);
  const hasShootout = input.events.some((e) => e.type === 'shootout_penalty');
  let shootout: MatchConsolidation['shootout'] = null;
  if (hasShootout) {
    const s = computeShootout(scoreEvents);
    shootout = { own: s.own, rival: s.rival, leader: s.leader };
  }

  return { players, score, shootout };
}
