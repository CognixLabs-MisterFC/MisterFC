/**
 * F6 Lote B (Mejora 3) — Reglas reglamentarias por modalidad. Datos estáticos
 * en código (como el catálogo de formaciones, ADR-0013): límites de jugadores
 * por formato. Usados para bloquear el cierre de convocatoria con exceso de
 * convocados y para topar los titulares en el campo.
 */

import type { TeamFormat } from './types';

export interface ModalityRules {
  /** Titulares sobre el campo (incluye portero). = nº de slots del preset. */
  starters: number;
  /** Máximo de convocados (titulares + reservas) que el coach puede llevar. */
  maxCalledUp: number;
  /** Máximo de reservas en el banquillo. */
  maxBench: number;
}

export const MODALITY_RULES: Record<TeamFormat, ModalityRules> = {
  F7: { starters: 7, maxCalledUp: 12, maxBench: 5 },
  F8: { starters: 8, maxCalledUp: 14, maxBench: 6 },
  F11: { starters: 11, maxCalledUp: 18, maxBench: 7 },
};

export function modalityRules(format: TeamFormat): ModalityRules {
  return MODALITY_RULES[format];
}

/** Titulares (sobre el campo) admitidos por la modalidad. */
export function startersFor(format: TeamFormat): number {
  return MODALITY_RULES[format].starters;
}

/** Máximo de convocados de la modalidad. */
export function maxCalledUpFor(format: TeamFormat): number {
  return MODALITY_RULES[format].maxCalledUp;
}

/**
 * ¿`count` convocados excede el máximo de la modalidad? Devuelve el sobrante
 * (>0 si hay que descartar jugadores) o 0 si cabe.
 */
export function calledUpOverflow(count: number, format: TeamFormat): number {
  return Math.max(0, count - MODALITY_RULES[format].maxCalledUp);
}
