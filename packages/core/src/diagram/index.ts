/**
 * F11.0 — API pública del módulo de DIAGRAMA de ejercicios (contrato puro).
 */

export {
  DIAGRAM_VERSION,
  MAX_DIAGRAM_ELEMENTS,
  MAX_LINE_POINTS,
  PLAYER_ROLES,
  ARROW_STYLES,
  STROKE_KINDS,
  ZONE_FILLS,
  STROKE_COLORS,
  ELEMENT_SIZES,
  FIELD_KINDS,
  FIELD_ORIENTATIONS,
  diagramElementSchema,
  diagramSchema,
  parseDiagram,
  isDiagram,
  emptyDiagram,
  elementAnchors,
} from './diagram';
export type {
  PlayerRole,
  ArrowStyle,
  StrokeKind,
  ZoneFill,
  StrokeColor,
  ElementSize,
  FieldKind,
  FieldOrientation,
  DiagramPoint,
  DiagramElement,
  DiagramElementType,
  DiagramField,
  Diagram,
} from './diagram';

// F11B.0 — Simplificación del trazo a mano alzada (dibujo libre).
export { simplifyStroke, DEFAULT_SIMPLIFY_EPSILON } from './simplify';

// F11B — Generador compartido del path SVG (suavizado del trazo a mano alzada).
export { smoothPathD } from './path';
export type { PathPoint } from './path';

// F11.5b — Reducer puro del editor (PitchEditor).
export {
  UNDO_LIMIT,
  DEFAULT_TEXT_LABEL,
  POINT_TOOLS,
  DRAW_TOOLS,
  FREEHAND_TOOL,
  initEditorState,
  toDiagram,
  canUndo,
  canRedo,
  pitchEditorReducer,
} from './editor';
export type { PointTool, DrawTool, FreehandTool, PitchTool, PitchEditorState, PitchAction } from './editor';
