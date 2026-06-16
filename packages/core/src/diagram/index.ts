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
  ElementSize,
  FieldKind,
  FieldOrientation,
  DiagramPoint,
  DiagramElement,
  DiagramElementType,
  DiagramField,
  Diagram,
} from './diagram';

// F11.5b — Reducer puro del editor (PitchEditor).
export {
  UNDO_LIMIT,
  DEFAULT_TEXT_LABEL,
  POINT_TOOLS,
  DRAW_TOOLS,
  initEditorState,
  toDiagram,
  canUndo,
  canRedo,
  pitchEditorReducer,
} from './editor';
export type { PointTool, DrawTool, PitchTool, PitchEditorState, PitchAction } from './editor';
