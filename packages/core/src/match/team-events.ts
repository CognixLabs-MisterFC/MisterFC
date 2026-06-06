/**
 * F7.4b — Faltas detalladas + córner a favor/en contra (PURO, sin DOM ni red).
 *
 * Refina los eventos de campo genéricos de 7.4 (`foul`, `corner`) con el bando
 * implicado, manteniendo el `match_events.type` existente (no hace falta migrar):
 *
 *  - FALTA (`type='foul'`, `side='own'`, `metadata.foul_kind`):
 *      'committed' → falta COMETIDA por nuestro equipo, `player_id` = quien la comete;
 *      'received'  → falta que NOS hacen, `player_id` = nuestro jugador que la recibe.
 *      Ambas con `x_pct`/`y_pct` (ubicación en el campo).
 *  - CÓRNER (`type='corner'`, `side='own'`, `metadata.corner_side`):
 *      'for'     → córner a favor; 'against' → córner en contra. Sin jugador ni coords.
 *
 * Compatibilidad: un `foul` antiguo (7.4) sin `foul_kind` se cuenta como COMETIDA
 * (la "falta" genérica era nuestra); un `corner` antiguo sin `corner_side`, como
 * A FAVOR. Todo se deriva de `match_events` → sobrevive a recargas.
 */

export type FoulKind = 'committed' | 'received';
export const FOUL_KINDS: readonly FoulKind[] = ['committed', 'received'] as const;
export function isFoulKind(value: string): value is FoulKind {
  return (FOUL_KINDS as readonly string[]).includes(value);
}

export type CornerSide = 'for' | 'against';
export const CORNER_SIDES: readonly CornerSide[] = ['for', 'against'] as const;
export function isCornerSide(value: string): value is CornerSide {
  return (CORNER_SIDES as readonly string[]).includes(value);
}

/** Proyección mínima de un evento de equipo (foul/corner) para los contadores. */
export interface TeamEventLite {
  type: string;
  playerId?: string | null;
  /** `metadata.foul_kind` (solo `foul`). */
  foulKind?: string | null;
  /** `metadata.corner_side` (solo `corner`). */
  cornerSide?: string | null;
}

export interface TeamEventTallies {
  foulsCommitted: number;
  foulsReceived: number;
  cornersFor: number;
  cornersAgainst: number;
}

/**
 * Contadores de faltas (propias/recibidas) y córners (a favor/en contra) desde
 * los eventos propios de campo. Defaults de compatibilidad: `foul` sin
 * `foul_kind` → cometida; `corner` sin `corner_side` → a favor.
 */
export function computeTeamEventTallies(
  events: readonly TeamEventLite[],
): TeamEventTallies {
  let foulsCommitted = 0;
  let foulsReceived = 0;
  let cornersFor = 0;
  let cornersAgainst = 0;
  for (const e of events) {
    if (e.type === 'foul') {
      if (e.foulKind === 'received') foulsReceived += 1;
      else foulsCommitted += 1;
    } else if (e.type === 'corner') {
      if (e.cornerSide === 'against') cornersAgainst += 1;
      else cornersFor += 1;
    }
  }
  return { foulsCommitted, foulsReceived, cornersFor, cornersAgainst };
}

/**
 * Faltas COMETIDAS atribuidas a cada jugador propio (disciplina). Las faltas
 * RECIBIDAS no se atribuyen aquí (las comete el rival; nuestro jugador solo las
 * recibe). Un `foul` sin `foul_kind` cuenta como cometida (compat 7.4).
 */
export function foulsByPlayer(
  events: readonly TeamEventLite[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'foul') continue;
    if (e.foulKind === 'received') continue;
    if (!e.playerId) continue;
    counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Faltas RECIBIDAS atribuidas a cada jugador propio (`foul_kind='received'`,
 * §7.4b: `player_id` = quien la recibe). Espejo de `foulsByPlayer` para la
 * consolidación al cierre (7.10). Las cometidas (incluido el `foul` legacy sin
 * `foul_kind`) no entran aquí.
 */
export function foulsReceivedByPlayer(
  events: readonly TeamEventLite[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'foul') continue;
    if (e.foulKind !== 'received') continue;
    if (!e.playerId) continue;
    counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
  }
  return counts;
}
