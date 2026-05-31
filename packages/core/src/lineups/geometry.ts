/**
 * F6 — Geometría y reasignación de alineaciones. Funciones PURAS (sin DOM,
 * sin reloj): el reducer del editor y los tests las usan igual. Reutilizables
 * por apps/native en Ola 2 (ADR-0013).
 */

import type { Formation, SlotRole } from './types';

/** Posición principal del jugador en BD (players.position_main). */
export type PlayerPositionMain =
  | 'goalkeeper'
  | 'defender'
  | 'midfielder'
  | 'forward'
  | null
  | undefined;

/** Mapea la posición de ficha del jugador al rol de slot del preset. */
export function roleFromPosition(position: PlayerPositionMain): SlotRole | null {
  switch (position) {
    case 'goalkeeper':
      return 'GK';
    case 'defender':
      return 'DF';
    case 'midfielder':
      return 'MF';
    case 'forward':
      return 'FW';
    default:
      return null;
  }
}

export interface FieldPlayerInput {
  playerId: string;
  /** Rol preferido (de su ficha) para casar con slots al reasignar. */
  role?: SlotRole | null;
}

export interface SlottedPlayer {
  playerId: string;
  positionCode: string;
  xPct: number;
  yPct: number;
}

export interface RemapResult {
  /** Jugadores colocados en slots de la nueva formación. */
  assignments: SlottedPlayer[];
  /** Jugadores que no caben en la nueva formación → al banquillo. */
  benched: string[];
}

/**
 * Reasigna los jugadores actualmente en el campo a los slots de `next`
 * conservando, cuando es posible, el rol de cada jugador (un DF cae en un slot
 * DF). Los que sobran (más jugadores que slots) van al banquillo.
 *
 * Algoritmo determinista en dos pasadas:
 *   1) Casa cada jugador con un slot libre de SU rol, respetando el orden de
 *      entrada (estable).
 *   2) Los jugadores sin rol o cuyo rol ya se agotó ocupan los slots libres
 *      restantes (orden del preset). Si no quedan slots → banquillo.
 *
 * No depende de la formación previa: solo del rol declarado de cada jugador,
 * lo que la hace robusta ante cualquier transición de formación.
 */
export function remapToFormation(
  fieldPlayers: FieldPlayerInput[],
  next: Formation,
): RemapResult {
  const available = next.slots.map((s) => ({ slot: s, taken: false }));
  const assignments: SlottedPlayer[] = [];
  const deferred: string[] = [];

  // Pasada 1 — casar por rol.
  for (const fp of fieldPlayers) {
    if (!fp.role) {
      deferred.push(fp.playerId);
      continue;
    }
    const match = available.find((a) => !a.taken && a.slot.role === fp.role);
    if (match) {
      match.taken = true;
      assignments.push({
        playerId: fp.playerId,
        positionCode: match.slot.code,
        xPct: match.slot.xPct,
        yPct: match.slot.yPct,
      });
    } else {
      deferred.push(fp.playerId);
    }
  }

  // Pasada 2 — rellenar slots libres con los diferidos.
  const benched: string[] = [];
  for (const playerId of deferred) {
    const free = available.find((a) => !a.taken);
    if (free) {
      free.taken = true;
      assignments.push({
        playerId,
        positionCode: free.slot.code,
        xPct: free.slot.xPct,
        yPct: free.slot.yPct,
      });
    } else {
      benched.push(playerId);
    }
  }

  return { assignments, benched };
}

/** Nº de jugadores de campo que admite una formación (= nº de slots). */
export function fieldCapacity(formation: Formation): number {
  return formation.slots.length;
}
