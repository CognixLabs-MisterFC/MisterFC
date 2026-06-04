/**
 * F7.7c — Penaltis y marcador (PURO, sin DOM ni red).
 *
 * Dos clases de penalti, distinguidas por `match_events.type`:
 *  - `penalty` (DURANTE el partido): sobre un jugador propio o un dorsal rival.
 *    `metadata.outcome ∈ {scored, saved, missed}` (marcado / parado / fuera). Un
 *    penalti **marcado CUENTA COMO GOL** de su bando — en el marcador y en las
 *    stats del jugador (7.8) — y NO se registra un `goal` aparte (no se duplica).
 *  - `shootout_penalty` (TANDA de desempate, tras la prórroga):
 *    `metadata.outcome ∈ {scored, missed}` (marcado / fallado). La tanda es
 *    APARTE: **no** suma minutos ni cuenta como gol del partido; su marcador se
 *    deriva por separado (p.ej. "Penaltis: 4-3").
 *
 * Todo se deriva de `match_events` → sobrevive a recargas (igual que el resto de
 * F7). Este módulo lo reusará el cierre 7.10 para consolidar el marcador.
 */

export type Side = 'own' | 'rival';

/** Resultado de un penalti DURANTE el partido. */
export type PenaltyOutcome = 'scored' | 'saved' | 'missed';
export const PENALTY_OUTCOMES: readonly PenaltyOutcome[] = [
  'scored',
  'saved',
  'missed',
] as const;
export function isPenaltyOutcome(value: string): value is PenaltyOutcome {
  return (PENALTY_OUTCOMES as readonly string[]).includes(value);
}

/** Resultado de un lanzamiento de la TANDA (solo marcado / fallado). */
export type ShootoutOutcome = 'scored' | 'missed';
export const SHOOTOUT_OUTCOMES: readonly ShootoutOutcome[] = [
  'scored',
  'missed',
] as const;
export function isShootoutOutcome(value: string): value is ShootoutOutcome {
  return (SHOOTOUT_OUTCOMES as readonly string[]).includes(value);
}

/** Proyección mínima de un evento para el cálculo del marcador. */
export interface ScoreEvent {
  side: Side;
  type: string;
  /** `metadata.outcome` (solo relevante en `penalty`). */
  outcome?: string | null;
}

/**
 * ¿Este evento CUENTA como gol del partido? Un `goal`, o un `penalty` con
 * `outcome='scored'`. La tanda (`shootout_penalty`) NUNCA cuenta como gol del
 * partido. Es la regla única que comparten el marcador y el conteo de goles por
 * jugador (7.8), para que no diverjan ni se dupliquen.
 */
export function isMatchGoal(ev: { type: string; outcome?: string | null }): boolean {
  if (ev.type === 'goal') return true;
  if (ev.type === 'penalty') return ev.outcome === 'scored';
  return false;
}

export interface MatchScore {
  own: number;
  rival: number;
}

/** Marcador del partido por bando = goles + penaltis marcados (sin la tanda). */
export function computeScore(events: readonly ScoreEvent[]): MatchScore {
  let own = 0;
  let rival = 0;
  for (const e of events) {
    if (!isMatchGoal(e)) continue;
    if (e.side === 'own') own += 1;
    else rival += 1;
  }
  return { own, rival };
}

export interface ShootoutTally {
  /** Marcados por cada bando en la tanda. */
  own: number;
  rival: number;
  /** Lanzamientos efectuados por cada bando (marcados + fallados). */
  ownTaken: number;
  rivalTaken: number;
  /**
   * Bando que va por delante en marcados (`null` si empatan). El operador decide
   * cuándo cerrar la tanda; al cerrar, `leader` es el ganador por penaltis. No se
   * codifican las reglas de "muerte súbita": la tanda no se puede cerrar empatada.
   */
  leader: Side | null;
}

/** Marcador de la TANDA (solo `shootout_penalty`); ignora cualquier otro tipo. */
export function computeShootout(events: readonly ScoreEvent[]): ShootoutTally {
  let own = 0;
  let rival = 0;
  let ownTaken = 0;
  let rivalTaken = 0;
  for (const e of events) {
    if (e.type !== 'shootout_penalty') continue;
    const scored = e.outcome === 'scored';
    if (e.side === 'own') {
      ownTaken += 1;
      if (scored) own += 1;
    } else {
      rivalTaken += 1;
      if (scored) rival += 1;
    }
  }
  const leader: Side | null = own > rival ? 'own' : rival > own ? 'rival' : null;
  return { own, rival, ownTaken, rivalTaken, leader };
}
