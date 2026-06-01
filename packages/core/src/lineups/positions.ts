/**
 * F6.10 (fix BUG 1) — Clave neutra canónica de posiciones.
 *
 * Antes coexistían dos vocabularios: el catálogo usaba códigos estructurales de
 * slot (GK/DF1/MF2…) y el editor de formaciones escribía etiquetas en castellano
 * (POR/DFC/LI…) crudas en BD. Aquí se define UNA clave neutra (independiente de
 * idioma) que se almacena, y la etiqueta visible sale por i18n (`positions.<key>`).
 *
 * Las claves cubren el vocabulario específico del entrenador (QUICK_CODES) y se
 * mapean a un rol genérico (SlotRole) para la geometría y los presets.
 */

import type { SlotRole } from './types';

/** Claves canónicas de posición (identificadores neutros, NO etiquetas). */
export const POSITION_KEYS = [
  'GK', // portero
  'RB', // lateral derecho
  'CB', // central
  'LB', // lateral izquierdo
  'DM', // mediocentro defensivo
  'CM', // mediocentro
  'RM', // medio derecho
  'LM', // medio izquierdo
  'AM', // mediapunta
  'RW', // extremo derecho
  'LW', // extremo izquierdo
  'ST', // delantero centro
] as const;

export type PositionKey = (typeof POSITION_KEYS)[number];

const POSITION_KEY_SET = new Set<string>(POSITION_KEYS);

export function isPositionKey(code: string): code is PositionKey {
  return POSITION_KEY_SET.has(code);
}

/**
 * Mapa de las etiquetas en castellano que usaba el editor (QUICK_CODES) a la
 * clave neutra. Sirve para normalizar datos ya persistidos y entradas legacy.
 */
const LEGACY_ES_TO_KEY: Record<string, PositionKey> = {
  POR: 'GK',
  LD: 'RB',
  DFC: 'CB',
  LI: 'LB',
  MCD: 'DM',
  MC: 'CM',
  MD: 'RM',
  MI: 'LM',
  MP: 'AM',
  ED: 'RW',
  EI: 'LW',
  DC: 'ST',
};

/** Rol genérico (geometría/preset) de cada clave de posición. */
const KEY_TO_ROLE: Record<PositionKey, SlotRole> = {
  GK: 'GK',
  RB: 'DF',
  CB: 'DF',
  LB: 'DF',
  DM: 'MF',
  CM: 'MF',
  RM: 'MF',
  LM: 'MF',
  AM: 'MF',
  RW: 'FW',
  LW: 'FW',
  ST: 'FW',
};

export function roleFromPositionKey(key: PositionKey): SlotRole {
  return KEY_TO_ROLE[key];
}

/**
 * Normaliza un código de posición a clave canónica. Acepta:
 *   - una clave canónica (se devuelve tal cual),
 *   - una etiqueta legacy en castellano (POR, DFC…) → su clave,
 *   - un código de slot del catálogo (GK, DF1, MF2…) → la clave por rol.
 * Si no se reconoce, devuelve null (el llamante decide el fallback).
 */
export function normalizePositionCode(code: string): PositionKey | null {
  const c = code.trim();
  if (isPositionKey(c)) return c;
  const legacy = LEGACY_ES_TO_KEY[c];
  if (legacy) return legacy;
  // Código de slot del catálogo: rol + índice (GK, DF1, MF2…). Mapea por rol a
  // una clave representativa (DF→CB, MF→CM, FW→ST).
  const role = c.replace(/[0-9]+$/, '');
  switch (role) {
    case 'GK':
      return 'GK';
    case 'DF':
      return 'CB';
    case 'MF':
      return 'CM';
    case 'FW':
      return 'ST';
    default:
      return null;
  }
}

/** Etiqueta canónica (para tests/logs): la propia clave. La UI usa i18n. */
export const DEFAULT_POSITION_KEY: PositionKey = 'CM';
