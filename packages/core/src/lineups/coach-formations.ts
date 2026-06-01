/**
 * F6.10 — Dominio de plantillas de formación personalizadas (coach_formations).
 *
 * Tipos y helpers agnósticos de framework para el editor de plantillas y el
 * selector "Mis formaciones". La posición se modela en snake_case
 * ({position_code, x_pct, y_pct}) igual que el JSONB persistido en BD.
 */

import type { Formation, FormationSlot, SlotRole, TeamFormat } from './types';
import { defaultFormation } from './formations';
import {
  type PositionKey,
  roleFromPositionKey,
} from './positions';

/**
 * Un hueco de la plantilla (forma del JSONB en coach_formations.positions).
 * `position_code` almacena una CLAVE NEUTRA canónica ([[PositionKey]]), no una
 * etiqueta localizada — la etiqueta visible sale por i18n (BUG 1).
 */
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

/**
 * Clave canónica de un slot del catálogo según su rol y su posición horizontal
 * (x: 0 izquierda … 100 derecha). Permite sembrar plantillas nuevas con claves
 * neutras específicas (LB/CB/RB…) en vez de los códigos estructurales GK/DF1.
 */
function keyFromRoleAndX(role: SlotRole, xPct: number): PositionKey {
  switch (role) {
    case 'GK':
      return 'GK';
    case 'DF':
      return xPct < 38 ? 'LB' : xPct > 62 ? 'RB' : 'CB';
    case 'MF':
      return xPct < 33 ? 'LM' : xPct > 67 ? 'RM' : 'CM';
    case 'FW':
      return xPct < 38 ? 'LW' : xPct > 62 ? 'RW' : 'ST';
  }
}

/** Convierte una formación del catálogo en posiciones editables (semilla). */
export function positionsFromFormation(
  formation: Formation,
): CoachFormationPosition[] {
  return formation.slots.map((s) => ({
    position_code: keyFromRoleAndX(s.role, s.xPct),
    x_pct: s.xPct,
    y_pct: s.yPct,
  }));
}

/**
 * Layout inicial al crear una formación nueva para una modalidad: parte del
 * preset por defecto del catálogo (F7→1-3-3, F8→1-3-3-1, F11→4-4-2), que ya
 * trae el nº de posiciones correcto, con claves canónicas. El coach las arrastra
 * desde ahí.
 */
export function blankFormationPositions(
  format: TeamFormat,
): CoachFormationPosition[] {
  return positionsFromFormation(defaultFormation(format));
}

/**
 * F6.10 (fix BUG 3) — sintetiza un `Formation` a partir de una plantilla del
 * entrenador, para que el editor de alineación renderice SU layout real (sus
 * x/y) en mode='edit'. Cada slot recibe un código ÚNICO (`<key>_<n>`) porque la
 * misma clave puede repetirse (dos CB), y el match jugador↔slot usa ese código.
 * `code` de la formación = el id de la coach_formation (no es del catálogo).
 */
export function coachFormationToFormation(cf: CoachFormation): Formation {
  const seen: Record<string, number> = {};
  const slots: FormationSlot[] = cf.positions.map((p) => {
    const key = p.position_code;
    seen[key] = (seen[key] ?? 0) + 1;
    return {
      code: `${key}_${seen[key]}`,
      role: roleFromPositionKey(key as PositionKey),
      xPct: p.x_pct,
      yPct: p.y_pct,
    };
  });
  return { code: cf.id, label: cf.name, format: cf.format, slots };
}

/**
 * Extrae la clave de posición ([[PositionKey]]) de un código de slot sintetizado
 * por [[coachFormationToFormation]] (`<key>_<n>` → `<key>`). Para etiquetar el
 * slot vía i18n. Si no tiene el sufijo, devuelve el código tal cual.
 */
export function positionKeyOfSlotCode(slotCode: string): string {
  const i = slotCode.lastIndexOf('_');
  return i > 0 ? slotCode.slice(0, i) : slotCode;
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
