/**
 * F6 — Tipos de dominio de alineaciones. Agnósticos de framework: los usan
 * tanto el catálogo/geometría de `packages/core` como `<MatchFieldEditor>`
 * (apps/web) y, en Ola 2, apps/native.
 */

/**
 * Modalidades de juego (teams.format en BD). ESTA es la fuente única: el tipo se
 * DERIVA de la tupla, no se escribe aparte.
 *
 * ── POR QUÉ, MEDIDO EL 2026-10-13 AL AÑADIR EL F5 ───────────────────────────
 * Antes había un comentario aquí diciendo que la fuente única era `TEAM_FORMATS`
 * de schemas/club-structure... y debajo el tipo escrito A MANO con los tres
 * formatos. O sea que eran dos listas que se mantenían por costumbre, más otras
 * dos hechas a mano en la UI (`FORMATS` del builder y `FILTERS` del manager).
 * Cuatro listas para una verdad.
 *
 * Al ampliar el tipo con 'F5', el typecheck solo señaló DOS sitios (el `Record`
 * de `MODALITY_RULES` y uno de sus tests): las otras tres listas no fallaban
 * porque una lista más corta de `TeamFormat[]` es perfectamente válida. El tipo
 * no protegía lo que importaba. Derivándolo de la tupla, añadir una modalidad es
 * una línea aquí y el compilador reclama sus reglas.
 *
 * Lo que el tipo NO puede impedir es que una modalidad entre en la lista sin
 * formaciones en el catálogo: eso explota en caliente (`defaultFormation` lanza).
 * Para eso hay un test que recorre TEAM_FORMATS y exige reglas y catálogo a cada
 * una — ver `formations.test.ts`.
 */
export const TEAM_FORMATS = ['F5', 'F7', 'F8', 'F11'] as const;

export type TeamFormat = (typeof TEAM_FORMATS)[number];

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

/**
 * Zona del jugador DENTRO de la alineación (lineup_positions.location).
 *
 * Rediseño Lote B': solo field/bench. La alineación trabaja sobre los
 * jugadores CONVOCADOS (called_up en callup_decisions) y solo los distribuye
 * en campo (titular) o banquillo (suplente). Descartar a un jugador ya NO es
 * una zona de la alineación: es una decisión de convocatoria.
 */
export type LineupLocation = 'field' | 'bench';

export const LINEUP_LOCATIONS: readonly LineupLocation[] = ['field', 'bench'] as const;

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
}
