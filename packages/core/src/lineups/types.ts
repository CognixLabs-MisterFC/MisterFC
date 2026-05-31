/**
 * F6 — Tipos de dominio de alineaciones. Agnósticos de framework: los usan
 * tanto el catálogo/geometría de `packages/core` como `<MatchFieldEditor>`
 * (apps/web) y, en Ola 2, apps/native.
 */

/**
 * Modalidad de juego del equipo (teams.format en BD). La const enumerada
 * `TEAM_FORMATS` vive en schemas/club-structure (fuente única); aquí solo el
 * tipo para no duplicar el export.
 */
export type TeamFormat = 'F7' | 'F8' | 'F11';

/** Rol genérico de un slot del preset. Mapea con players.position_main. */
export type SlotRole = 'GK' | 'DF' | 'MF' | 'FW';

/**
 * Un hueco de la formación sobre el campo.
 *
 * Sistema de coordenadas (0–100), equipo atacando hacia ARRIBA:
 *   - x: 0 banda izquierda · 50 centro · 100 banda derecha.
 *   - y: 0 línea de gol rival (arriba) · 100 línea de gol propia (abajo, GK).
 */
export interface FormationSlot {
  /** Código único dentro de la formación, p.ej. 'GK', 'DF1', 'MF2'. */
  code: string;
  role: SlotRole;
  xPct: number;
  yPct: number;
}

export interface Formation {
  /** Código estable, p.ej. '4-3-3', '1-3-3'. Es lo que se guarda en BD. */
  code: string;
  /** Etiqueta legible para la UI, p.ej. '4-3-3'. */
  label: string;
  format: TeamFormat;
  slots: FormationSlot[];
}

/** Zona del jugador dentro de la alineación (lineup_positions.location). */
export type LineupLocation = 'field' | 'bench' | 'out';

export const LINEUP_LOCATIONS: readonly LineupLocation[] = [
  'field',
  'bench',
  'out',
] as const;

/** Motivo de "fuera de convocatoria" (lineup_positions.out_reason). */
export type OutReason = 'tecnico' | 'fisico' | 'disciplinario' | 'personal';

export const OUT_REASONS: readonly OutReason[] = [
  'tecnico',
  'fisico',
  'disciplinario',
  'personal',
] as const;

/**
 * Posición de un jugador en una alineación (proyección de lineup_positions,
 * sin campos de auditoría). Es lo que el reducer del editor manipula.
 */
export interface PositionAssignment {
  playerId: string;
  location: LineupLocation;
  /** Solo en field. */
  positionCode: string | null;
  /** Solo en field. */
  xPct: number | null;
  yPct: number | null;
  /** Solo en out. */
  outReason: OutReason | null;
}
