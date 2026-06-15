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
  FieldKind,
  FieldOrientation,
  DiagramPoint,
  DiagramElement,
  DiagramElementType,
  DiagramField,
  Diagram,
} from './diagram';
