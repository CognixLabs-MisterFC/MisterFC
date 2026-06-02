/**
 * F7.6b — Táctica en directo (solo NUESTRO equipo): mover jugadores y cambiar la
 * formación durante el partido. Puro y agnóstico de framework/BD.
 *
 * El estado táctico VIVO (formación + posiciones por jugador) se persiste aparte
 * del once inicial (`match_starters`) y de la alineación oficial de F6: vive en
 * `match_state` (live_formation_code / live_positions) y se HIDRATA al recargar.
 * No sobrescribe quién empezó.
 *
 * Reutiliza el catálogo de formaciones de F6 (`Formation`/`FormationSlot`): al
 * cambiar de formación, los jugadores que están en el campo se reparten en los
 * slots de la nueva formación (defensa→ataque, izq→der).
 */

import type { Formation } from '../lineups/types';

/** Posición viva de un jugador en el campo (override sobre el slot oficial). */
export interface LivePosition {
  /** Slot de la formación que ocupa (informativo); null si es libre. */
  positionCode: string | null;
  xPct: number;
  yPct: number;
}

/** Mapa playerId → posición viva (lo que se guarda en match_state.live_positions). */
export type LivePositions = Record<string, LivePosition>;

/** Acota un porcentaje a [0, 100] y lo redondea a 2 decimales. */
export function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0;
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * Mueve a un jugador a una nueva posición (x/y), conservando su `positionCode`.
 * Devuelve un mapa nuevo (no muta la entrada).
 */
export function moveLivePlayer(
  positions: LivePositions,
  playerId: string,
  xPct: number,
  yPct: number,
): LivePositions {
  const prev = positions[playerId];
  return {
    ...positions,
    [playerId]: {
      positionCode: prev?.positionCode ?? null,
      xPct: clampPct(xPct),
      yPct: clampPct(yPct),
    },
  };
}

/** Posición actual de un jugador del campo (para repartir al cambiar formación). */
export interface FieldPlayerPos {
  playerId: string;
  xPct: number;
  yPct: number;
}

/**
 * Orden canónico defensa→ataque, izquierda→derecha. `yPct` alto = portería
 * propia (atrás); bajo = ataque (arriba). Empata por `xPct` ascendente.
 */
function byFieldOrder<T extends { xPct: number; yPct: number }>(a: T, b: T): number {
  if (b.yPct !== a.yPct) return b.yPct - a.yPct;
  return a.xPct - b.xPct;
}

/**
 * Reparte a los jugadores que están EN EL CAMPO en los slots de `formation`.
 * Empareja por orden de campo (el más retrasado al slot más retrasado, etc.),
 * de modo que el portero acabe en el slot de portero y la línea defensiva en la
 * defensa. Si hay menos jugadores que slots (alguien expulsado/ausente), se
 * llenan los primeros slots y el resto queda vacío. Si hubiera más jugadores que
 * slots (caso anómalo), los sobrantes conservan su posición actual.
 *
 * Devuelve el mapa de posiciones vivas SOLO de los jugadores recibidos.
 */
export function assignPlayersToFormation(
  players: readonly FieldPlayerPos[],
  formation: Formation,
): LivePositions {
  const sortedPlayers = [...players].sort(byFieldOrder);
  const sortedSlots = [...formation.slots].sort(byFieldOrder);

  const out: LivePositions = {};
  for (let i = 0; i < sortedPlayers.length; i += 1) {
    const player = sortedPlayers[i];
    if (!player) continue;
    const slot = sortedSlots[i];
    if (slot) {
      out[player.playerId] = {
        positionCode: slot.code,
        xPct: slot.xPct,
        yPct: slot.yPct,
      };
    } else {
      // Más jugadores que slots: conserva su posición actual.
      out[player.playerId] = {
        positionCode: null,
        xPct: clampPct(player.xPct),
        yPct: clampPct(player.yPct),
      };
    }
  }
  return out;
}
