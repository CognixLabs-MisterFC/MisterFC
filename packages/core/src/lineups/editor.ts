/**
 * F6.3/6.7 — Lógica pura del editor de alineaciones (drag&drop). Sin DOM ni
 * dnd-kit: resuelve un drop a un cambio de zona y aplica el cambio al conjunto
 * de asignaciones manteniendo el invariante "un jugador, una zona". El cliente
 * (apps/web) la usa para el estado optimista; los tests la cubren sin navegador.
 *
 * Los ids de drag&drop viven aquí (strings agnósticos) para que el componente
 * y el cliente compartan la MISMA convención sin duplicarla.
 */

import type { Formation, OutReason, PositionAssignment } from './types';

export const FIELD_SLOT_PREFIX = 'lineup-slot:';
export const PLAYER_DRAG_PREFIX = 'lineup-player:';
export const BENCH_ZONE_ID = 'lineup-zone:bench';
export const OUT_ZONE_ID = 'lineup-zone:out';

export const fieldSlotDroppableId = (slotCode: string): string =>
  `${FIELD_SLOT_PREFIX}${slotCode}`;
export const playerDraggableId = (playerId: string): string =>
  `${PLAYER_DRAG_PREFIX}${playerId}`;

export const parseFieldSlotId = (id: string): string | null =>
  id.startsWith(FIELD_SLOT_PREFIX) ? id.slice(FIELD_SLOT_PREFIX.length) : null;
export const parsePlayerDragId = (id: string): string | null =>
  id.startsWith(PLAYER_DRAG_PREFIX) ? id.slice(PLAYER_DRAG_PREFIX.length) : null;

export type DropTarget =
  | { kind: 'field'; slotCode: string }
  | { kind: 'bench' }
  | { kind: 'out' };

export interface ResolvedDrop {
  playerId: string;
  target: DropTarget;
}

/**
 * Traduce un par (activeId, overId) de dnd-kit a un drop de dominio. Devuelve
 * null si el over no es una zona reconocida o el active no es un jugador.
 */
export function resolveDrop(
  activeId: string,
  overId: string | null | undefined,
): ResolvedDrop | null {
  const playerId = parsePlayerDragId(activeId);
  if (!playerId || !overId) return null;

  const slotCode = parseFieldSlotId(overId);
  if (slotCode) return { playerId, target: { kind: 'field', slotCode } };
  if (overId === BENCH_ZONE_ID) return { playerId, target: { kind: 'bench' } };
  if (overId === OUT_ZONE_ID) return { playerId, target: { kind: 'out' } };
  return null;
}

export interface ApplyDropResult {
  next: PositionAssignment[];
  /** playerIds cuyo estado cambió (a persistir). */
  changed: string[];
}

/**
 * Aplica un drop al conjunto de asignaciones. Mantiene el invariante "un
 * jugador, una zona" y, al soltar sobre un slot de campo ya ocupado por OTRO
 * jugador, desplaza al ocupante al banquillo (swap). Función pura: no muta la
 * entrada, devuelve un array nuevo + la lista de jugadores afectados.
 */
export function applyDrop(
  assignments: PositionAssignment[],
  drop: ResolvedDrop,
  formation: Formation | undefined,
  defaultOutReason: OutReason = 'tecnico',
): ApplyDropResult {
  const { playerId, target } = drop;
  const byId = new Map<string, PositionAssignment>(
    assignments.map((a) => [a.playerId, { ...a }]),
  );
  const me = byId.get(playerId);
  if (!me) return { next: assignments, changed: [] };

  const changed = new Set<string>();

  if (target.kind === 'field') {
    // Desplaza al ocupante previo del slot (si es otro jugador) al banquillo.
    for (const a of byId.values()) {
      if (
        a.playerId !== playerId &&
        a.location === 'field' &&
        a.positionCode === target.slotCode
      ) {
        a.location = 'bench';
        a.positionCode = null;
        a.xPct = null;
        a.yPct = null;
        a.outReason = null;
        changed.add(a.playerId);
      }
    }
    const slot = formation?.slots.find((s) => s.code === target.slotCode);
    me.location = 'field';
    me.positionCode = target.slotCode;
    me.xPct = slot ? slot.xPct : null;
    me.yPct = slot ? slot.yPct : null;
    me.outReason = null;
    changed.add(playerId);
  } else if (target.kind === 'bench') {
    me.location = 'bench';
    me.positionCode = null;
    me.xPct = null;
    me.yPct = null;
    me.outReason = null;
    changed.add(playerId);
  } else {
    me.location = 'out';
    me.positionCode = null;
    me.xPct = null;
    me.yPct = null;
    me.outReason = me.outReason ?? defaultOutReason;
    changed.add(playerId);
  }

  return { next: Array.from(byId.values()), changed: Array.from(changed) };
}
