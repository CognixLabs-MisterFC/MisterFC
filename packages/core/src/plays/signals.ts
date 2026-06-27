/**
 * Señas/pictogramas de jugadas de estrategia (TANDA 1) — PURO `@misterfc/core`.
 *
 * Las jugadas del banco del club (ADR-0019) son jugadas de ESTRATEGIA. Cada jugada
 * lleva dos campos obligatorios (en el formulario):
 *   · `strategy_type` — tipo de estrategia (corner | falta | saque_banda | saque_centro).
 *   · `signal_id`     — una seña del catálogo fijo de 10 (el gesto que hace el jugador).
 *
 * El catálogo se modela como DATOS neutros (sin JSX): cada seña es un monigote
 * esquemático descrito con primitivas (`line`/`circle`/`path`) sobre un viewBox
 * común. Así se renderiza tanto en web (`<svg>` del DOM) como en PDF
 * (`<Svg>`/`<Path>`/`<Line>`/`<Circle>` de `@react-pdf/renderer`) con dos
 * renderers triviales que mapean las mismas primitivas — sin duplicar el dibujo.
 */

// ── Tipo de estrategia ────────────────────────────────────────────────────────
export const STRATEGY_TYPES = ['corner', 'falta', 'saque_banda', 'saque_centro'] as const;
export type StrategyType = (typeof STRATEGY_TYPES)[number];

export function isStrategyType(v: unknown): v is StrategyType {
  return typeof v === 'string' && (STRATEGY_TYPES as readonly string[]).includes(v);
}

// ── Catálogo de señas ─────────────────────────────────────────────────────────
export const PLAY_SIGNAL_IDS = [
  'brazo_derecho_arriba',
  'brazo_izquierdo_arriba',
  'dos_brazos_arriba',
  'tocarse_cabeza',
  'brazos_cruzados_pecho',
  'mano_cadera',
  'senalar_suelo',
  'brazo_horizontal',
  'tocarse_pecho',
  'puno_alto',
] as const;
export type PlaySignalId = (typeof PLAY_SIGNAL_IDS)[number];

export function isPlaySignalId(v: unknown): v is PlaySignalId {
  return typeof v === 'string' && (PLAY_SIGNAL_IDS as readonly string[]).includes(v);
}

/** Lienzo común de todos los pictogramas (cuadrado). */
export const PLAY_SIGNAL_VIEWBOX = '0 0 48 48';

/** Primitiva de dibujo neutra (renderizable en web y en @react-pdf). */
export type SignalShape =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'circle'; cx: number; cy: number; r: number; filled?: boolean }
  | { t: 'path'; d: string };

export type PlaySignal = {
  id: PlaySignalId;
  /** Clave i18n de la etiqueta (namespace `jugadas.signals`). */
  labelKey: string;
  /** Monigote esquemático con el gesto, sobre PLAY_SIGNAL_VIEWBOX. */
  shapes: SignalShape[];
};

// Monigote BASE (cabeza + tronco + piernas), común a todas las señas. Los brazos /
// extras específicos del gesto se añaden por seña con `withBase(...)`.
const BASE: SignalShape[] = [
  { t: 'circle', cx: 24, cy: 9, r: 4 }, // cabeza
  { t: 'line', x1: 24, y1: 13, x2: 24, y2: 30 }, // tronco
  { t: 'line', x1: 24, y1: 30, x2: 17, y2: 43 }, // pierna izq.
  { t: 'line', x1: 24, y1: 30, x2: 31, y2: 43 }, // pierna der.
];

function withBase(...arms: SignalShape[]): SignalShape[] {
  return [...BASE, ...arms];
}

// Brazos en reposo (hacia abajo) reutilizables.
const REST_LEFT: SignalShape = { t: 'line', x1: 24, y1: 17, x2: 15, y2: 26 };
const REST_RIGHT: SignalShape = { t: 'line', x1: 24, y1: 17, x2: 33, y2: 26 };

/**
 * Catálogo FIJO de 10 señas. El orden es el de `PLAY_SIGNAL_IDS`. Cada gesto se
 * distingue de un vistazo (brazo arriba/horizontal/abajo, cruzados, jarras, etc.).
 */
export const PLAY_SIGNAL_CATALOG: PlaySignal[] = [
  {
    id: 'brazo_derecho_arriba',
    labelKey: 'brazo_derecho_arriba',
    // Brazo derecho (lado derecho de la imagen) arriba; izquierdo en reposo.
    shapes: withBase(REST_LEFT, { t: 'line', x1: 24, y1: 17, x2: 34, y2: 7 }),
  },
  {
    id: 'brazo_izquierdo_arriba',
    labelKey: 'brazo_izquierdo_arriba',
    shapes: withBase({ t: 'line', x1: 24, y1: 17, x2: 14, y2: 7 }, REST_RIGHT),
  },
  {
    id: 'dos_brazos_arriba',
    labelKey: 'dos_brazos_arriba',
    shapes: withBase(
      { t: 'line', x1: 24, y1: 17, x2: 14, y2: 7 },
      { t: 'line', x1: 24, y1: 17, x2: 34, y2: 7 },
    ),
  },
  {
    id: 'tocarse_cabeza',
    labelKey: 'tocarse_cabeza',
    // Manos a la cabeza: brazos cortos doblados que terminan junto a la cabeza.
    shapes: withBase(
      { t: 'path', d: 'M24 17 L18 14 L20 8' },
      { t: 'path', d: 'M24 17 L30 14 L28 8' },
    ),
  },
  {
    id: 'brazos_cruzados_pecho',
    labelKey: 'brazos_cruzados_pecho',
    // Aspa sobre el pecho = brazos cruzados.
    shapes: withBase(
      { t: 'line', x1: 18, y1: 19, x2: 30, y2: 27 },
      { t: 'line', x1: 30, y1: 19, x2: 18, y2: 27 },
    ),
  },
  {
    id: 'mano_cadera',
    labelKey: 'mano_cadera',
    // Jarras: codos hacia fuera, manos a la cadera.
    shapes: withBase(
      { t: 'path', d: 'M24 18 L15 22 L21 28' },
      { t: 'path', d: 'M24 18 L33 22 L27 28' },
    ),
  },
  {
    id: 'senalar_suelo',
    labelKey: 'senalar_suelo',
    // Un brazo señala al suelo en diagonal; el otro en reposo.
    shapes: withBase(REST_LEFT, { t: 'line', x1: 24, y1: 17, x2: 36, y2: 34 }),
  },
  {
    id: 'brazo_horizontal',
    labelKey: 'brazo_horizontal',
    // Un brazo extendido en horizontal; el otro en reposo.
    shapes: withBase(REST_LEFT, { t: 'line', x1: 24, y1: 17, x2: 41, y2: 17 }),
  },
  {
    id: 'tocarse_pecho',
    labelKey: 'tocarse_pecho',
    // Mano al pecho (brazo doblado al centro); el otro en reposo.
    shapes: withBase(REST_LEFT, { t: 'path', d: 'M24 18 L31 21 L24 23' }),
  },
  {
    id: 'puno_alto',
    labelKey: 'puno_alto',
    // Puño en alto: brazo arriba con un nudillo (círculo relleno) en la punta.
    shapes: withBase(
      REST_LEFT,
      { t: 'line', x1: 24, y1: 17, x2: 32, y2: 8 },
      { t: 'circle', cx: 33, cy: 7, r: 2.6, filled: true },
    ),
  },
];

/** Búsqueda por id (o undefined si no existe). */
export function getPlaySignal(id: string | null | undefined): PlaySignal | undefined {
  return PLAY_SIGNAL_CATALOG.find((sgn) => sgn.id === id);
}
