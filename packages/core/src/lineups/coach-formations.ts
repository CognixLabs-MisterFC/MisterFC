/**
 * F6.10 — Dominio de plantillas de formación personalizadas (coach_formations).
 *
 * Tipos y helpers agnósticos de framework para el editor de plantillas y el
 * selector "Mis formaciones". La posición se modela en snake_case
 * ({position_code, x_pct, y_pct}) igual que el JSONB persistido en BD.
 */

import type { Formation, TeamFormat } from './types';
import { defaultFormation } from './formations';

/** Un hueco de la plantilla (forma del JSONB en coach_formations.positions). */
export interface CoachFormationPosition {
  position_code: string;
  x_pct: number;
  y_pct: number;
}

/** Proyección de una fila de coach_formations para la UI. */
export interface CoachFormation {
  id: string;
  name: string;
  format: TeamFormat;
  positions: CoachFormationPosition[];
}

/** Convierte una formación del catálogo en posiciones editables (semilla). */
export function positionsFromFormation(
  formation: Formation,
): CoachFormationPosition[] {
  return formation.slots.map((s) => ({
    position_code: s.code,
    x_pct: s.xPct,
    y_pct: s.yPct,
  }));
}

/**
 * Layout inicial al crear una formación nueva para una modalidad: parte del
 * preset por defecto del catálogo (F7→1-3-3, F8→1-3-3-1, F11→4-4-2), que ya
 * trae el nº de posiciones correcto. El coach las arrastra desde ahí.
 */
export function blankFormationPositions(
  format: TeamFormat,
): CoachFormationPosition[] {
  return positionsFromFormation(defaultFormation(format));
}

/** Acota un porcentaje a [0,100] con 2 decimales (drag sobre el campo). */
export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export interface FormationPlacement {
  /** Jugadores colocados en el campo, con su slot de la plantilla. */
  placed: { playerId: string; position: CoachFormationPosition }[];
  /** Jugadores que no caben en la plantilla → al banquillo. */
  benched: string[];
}

/**
 * F6.10 — "adopta" una plantilla del coach como layout del campo: coloca a los
 * jugadores (primero los que ya están en campo, luego rellena desde el
 * banquillo) en las N posiciones de la plantilla, en orden. Los que no caben
 * van al banquillo. Determinista y sin estado para poder testarlo.
 */
export function placeOnFormation(
  fieldPlayerIds: string[],
  benchPlayerIds: string[],
  positions: CoachFormationPosition[],
): FormationPlacement {
  const ordered = [...fieldPlayerIds, ...benchPlayerIds];
  const placed = positions.map((position, i) => ({
    playerId: ordered[i],
    position,
  }));
  // Filtra slots sin jugador (menos jugadores que posiciones).
  const filled = placed.filter(
    (p): p is { playerId: string; position: CoachFormationPosition } =>
      p.playerId !== undefined,
  );
  const placedIds = new Set(filled.map((p) => p.playerId));
  const benched = ordered.filter((id) => !placedIds.has(id));
  return { placed: filled, benched };
}
