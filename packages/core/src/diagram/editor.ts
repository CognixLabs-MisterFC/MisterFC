/**
 * F11.5b (PR1) — Reducer PURO del editor de diagramas (PitchEditor).
 *
 * Sin DOM, sin React: todo el ESTADO del editor (elementos, selección,
 * herramienta activa, config del próximo elemento e historial undo/redo) vive
 * aquí como una función pura `pitchEditorReducer(state, action)`. La capa
 * React/dnd de `apps/web` es glue fino encima. Así se testea con el Vitest del
 * paquete `core` sin runner de DOM.
 *
 * INVARIANTE: `toDiagram(state)` SIEMPRE produce un `Diagram` que pasa
 * `parseDiagram` (coords clampadas a 0–100, ids no vacíos y únicos, `texto`
 * nunca vacío).
 *
 * PR1 cubre los elementos anclados por UN punto + seleccionar/mover/borrar +
 * undo/redo. Los elementos DIBUJADOS (flecha, linea, zona) llegan en PR2; el
 * shape del estado ya los admite sin cambios (van en `elements` como cualquier
 * otro `DiagramElement`).
 *
 * Decisiones (acordadas con producto):
 *  - Historial = snapshots de `elements`. Cuentan como UN paso: PLACE, MOVE,
 *    DELETE, UPDATE_LABEL, UPDATE_TEXT. NO cuentan: cambiar herramienta, cambiar
 *    el campo, seleccionar, ni editar la config del próximo elemento.
 *  - `MOVE` es la confirmación de un arrastre (el preview por píxel lo hace el
 *    glue local; aquí entra UN solo MOVE al soltar).
 *  - IDs deterministas: contador monotónico en el estado (`el-1`, `el-2`…). NO
 *    se reduce al deshacer (evita reutilizar un id y colisionar al rehacer). Al
 *    inicializar desde un Diagram existente, arranca por encima del id máximo.
 *  - Tope del historial: UNDO_LIMIT (se descarta el más antiguo).
 */

import {
  DIAGRAM_VERSION,
  type Diagram,
  type DiagramElement,
  type DiagramField,
  type FieldKind,
  type PlayerRole,
  type ArrowStyle,
  type StrokeKind,
  type ZoneFill,
  type ElementSize,
  type DiagramPoint,
} from './diagram';

export const UNDO_LIMIT = 50;

/** Texto por defecto si se coloca un elemento `texto` sin teclear nada (el
 *  contrato exige ≥1 char; el glue abre el editor inline para cambiarlo). */
export const DEFAULT_TEXT_LABEL = 'Texto';

/** Herramientas de PR1: selección + elementos anclados por un punto. */
export const POINT_TOOLS = [
  'jugador',
  'balon',
  'cono',
  'aro',
  'gol_conduccion',
  'porteria',
  'miniporteria',
  'texto',
] as const;
export type PointTool = (typeof POINT_TOOLS)[number];

/** Herramientas de PR2: elementos DIBUJADOS por arrastre (from→to). */
export const DRAW_TOOLS = ['flecha', 'linea', 'zona'] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];

export type PitchTool = 'select' | PointTool | DrawTool;

type Snapshot = DiagramElement[];

export type PitchEditorState = {
  field: DiagramField;
  elements: DiagramElement[];
  selectedId: string | null;
  tool: PitchTool;
  /** Config del PRÓXIMO elemento a colocar/dibujar (barra de herramientas). */
  nextRole: PlayerRole;
  nextLabel: string;
  nextText: string;
  nextArrowStyle: ArrowStyle;
  nextStroke: StrokeKind;
  /** Relleno de la PRÓXIMA zona (null = Ninguno = contorno; default). */
  nextFill: ZoneFill | null;
  /** Tamaño del próximo elemento de punto (default 'md' = tamaño actual). */
  nextSize: ElementSize;
  past: Snapshot[];
  future: Snapshot[];
  counter: number;
};

export type PitchAction =
  | { type: 'SET_TOOL'; tool: PitchTool }
  | { type: 'SET_FIELD_KIND'; kind: FieldKind }
  | { type: 'SET_NEXT_ROLE'; role: PlayerRole }
  | { type: 'SET_NEXT_LABEL'; label: string }
  | { type: 'SET_NEXT_TEXT'; text: string }
  | { type: 'SET_NEXT_ARROW_STYLE'; style: ArrowStyle }
  | { type: 'SET_NEXT_STROKE'; stroke: StrokeKind }
  | { type: 'SET_NEXT_FILL'; fill: ZoneFill | null }
  | { type: 'SET_NEXT_SIZE'; size: ElementSize }
  | { type: 'PLACE'; x_pct: number; y_pct: number }
  // Confirmación de un dibujo (rubber-band) — 1 paso de undo cada uno.
  | { type: 'ADD_ARROW'; from: DiagramPoint; to: DiagramPoint }
  | { type: 'ADD_LINE'; from: DiagramPoint; to: DiagramPoint }
  | { type: 'ADD_ZONA'; from: DiagramPoint; to: DiagramPoint }
  | { type: 'SELECT'; id: string | null }
  | { type: 'MOVE'; id: string; x_pct: number; y_pct: number }
  | { type: 'TRANSLATE'; id: string; dx: number; dy: number }
  | { type: 'DELETE'; id: string }
  | { type: 'UPDATE_LABEL'; id: string; label: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_ARROW_STYLE'; id: string; style: ArrowStyle }
  | { type: 'UPDATE_STROKE'; id: string; stroke: StrokeKind }
  | { type: 'UPDATE_FILL'; id: string; fill: ZoneFill | null }
  | { type: 'UPDATE_SIZE'; id: string; size: ElementSize }
  | { type: 'UNDO' }
  | { type: 'REDO' };

const clampPct = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

function maxIdCounter(elements: DiagramElement[]): number {
  let max = 0;
  for (const el of elements) {
    const raw = /^el-(\d+)$/.exec(el.id)?.[1];
    if (raw !== undefined) {
      const n = parseInt(raw, 10);
      if (n > max) max = n;
    }
  }
  return max;
}

export function initEditorState(diagram?: Diagram): PitchEditorState {
  const elements = diagram ? [...diagram.elements] : [];
  return {
    field: diagram ? { ...diagram.field } : { kind: 'completo', orientation: 'vertical' },
    elements,
    selectedId: null,
    tool: 'select',
    nextRole: 'atacante',
    nextLabel: '',
    nextText: '',
    nextArrowStyle: 'pase',
    nextStroke: 'solid',
    nextFill: null,
    nextSize: 'md',
    past: [],
    future: [],
    counter: maxIdCounter(elements),
  };
}

/** Escena actual como `Diagram` del contrato 11.0 (pasa `parseDiagram`). */
export function toDiagram(state: PitchEditorState): Diagram {
  return { version: DIAGRAM_VERSION, field: state.field, elements: state.elements };
}

export const canUndo = (state: PitchEditorState): boolean => state.past.length > 0;
export const canRedo = (state: PitchEditorState): boolean => state.future.length > 0;

/** Empuja el snapshot actual al historial (con tope) y limpia el `future`. */
function pushPast(past: Snapshot[], current: Snapshot): Snapshot[] {
  const appended = [...past, current];
  return appended.length > UNDO_LIMIT ? appended.slice(appended.length - UNDO_LIMIT) : appended;
}

/** Construye el elemento de punto de la herramienta activa, o null si la
 *  herramienta no coloca puntos (select / herramientas de PR2). */
function buildPointElement(
  state: PitchEditorState,
  id: string,
  x_pct: number,
  y_pct: number,
): DiagramElement | null {
  // `size` solo se guarda si no es el default 'md' (mantiene la forma limpia y
  // retrocompatible: ausente = md).
  const sz = state.nextSize !== 'md' ? { size: state.nextSize } : {};
  switch (state.tool) {
    case 'jugador': {
      const label = state.nextLabel.trim();
      return label
        ? { type: 'jugador', id, x_pct, y_pct, role: state.nextRole, label, ...sz }
        : { type: 'jugador', id, x_pct, y_pct, role: state.nextRole, ...sz };
    }
    case 'balon':
      return { type: 'balon', id, x_pct, y_pct, ...sz };
    case 'cono':
      return { type: 'cono', id, x_pct, y_pct, ...sz };
    case 'aro':
      return { type: 'aro', id, x_pct, y_pct, ...sz };
    case 'gol_conduccion':
      return { type: 'gol_conduccion', id, x_pct, y_pct, ...sz };
    case 'porteria':
      return { type: 'porteria', id, x_pct, y_pct, ...sz };
    case 'miniporteria':
      return { type: 'miniporteria', id, x_pct, y_pct, ...sz };
    case 'texto':
      return { type: 'texto', id, x_pct, y_pct, text: state.nextText.trim() || DEFAULT_TEXT_LABEL, ...sz };
    default:
      return null;
  }
}

const clampPoint = (p: DiagramPoint): DiagramPoint => ({
  x_pct: clampPct(p.x_pct),
  y_pct: clampPct(p.y_pct),
});

/** Puntos geométricos que deben permanecer en [0,100] al trasladar un elemento.
 *  (zona se ancla por su esquina origen; w/h se preservan). */
function clampAnchors(el: DiagramElement): DiagramPoint[] {
  switch (el.type) {
    case 'flecha':
    case 'cota':
      return [el.from, el.to];
    case 'linea':
      return el.points;
    case 'zona':
      return [{ x_pct: el.x_pct, y_pct: el.y_pct }];
    default:
      return [{ x_pct: el.x_pct, y_pct: el.y_pct }];
  }
}

/** Aplica un desplazamiento (ya acotado) a TODOS los puntos del elemento. */
function applyTranslate(el: DiagramElement, dx: number, dy: number): DiagramElement {
  const shift = (p: DiagramPoint): DiagramPoint => clampPoint({ x_pct: p.x_pct + dx, y_pct: p.y_pct + dy });
  switch (el.type) {
    case 'flecha':
    case 'cota':
      return { ...el, from: shift(el.from), to: shift(el.to) };
    case 'linea':
      return { ...el, points: el.points.map(shift) };
    case 'zona': {
      const o = shift({ x_pct: el.x_pct, y_pct: el.y_pct });
      return { ...el, x_pct: o.x_pct, y_pct: o.y_pct };
    }
    default: {
      const o = shift({ x_pct: el.x_pct, y_pct: el.y_pct });
      return { ...el, x_pct: o.x_pct, y_pct: o.y_pct };
    }
  }
}

export function pitchEditorReducer(
  state: PitchEditorState,
  action: PitchAction,
): PitchEditorState {
  switch (action.type) {
    // ── Estado no-documental (fuera del historial) ───────────────────────────
    case 'SET_TOOL':
      return { ...state, tool: action.tool };
    case 'SET_FIELD_KIND':
      return { ...state, field: { kind: action.kind, orientation: state.field.orientation } };
    case 'SET_NEXT_ROLE':
      return { ...state, nextRole: action.role };
    case 'SET_NEXT_LABEL':
      return { ...state, nextLabel: action.label };
    case 'SET_NEXT_TEXT':
      return { ...state, nextText: action.text };
    case 'SET_NEXT_ARROW_STYLE':
      return { ...state, nextArrowStyle: action.style };
    case 'SET_NEXT_STROKE':
      return { ...state, nextStroke: action.stroke };
    case 'SET_NEXT_FILL':
      return { ...state, nextFill: action.fill };
    case 'SET_NEXT_SIZE':
      return { ...state, nextSize: action.size };
    case 'SELECT':
      return {
        ...state,
        selectedId:
          action.id != null && state.elements.some((e) => e.id === action.id) ? action.id : null,
      };

    // ── Mutaciones del documento (un paso de historial cada una) ──────────────
    case 'PLACE': {
      const counter = state.counter + 1;
      const id = `el-${counter}`;
      const el = buildPointElement(state, id, clampPct(action.x_pct), clampPct(action.y_pct));
      if (!el) return state; // herramienta 'select' o de PR2 → no coloca
      return {
        ...state,
        elements: [...state.elements, el],
        past: pushPast(state.past, state.elements),
        future: [],
        counter,
        selectedId: id,
      };
    }

    // ── Confirmación de dibujos (rubber-band → 1 paso de historial) ───────────
    case 'ADD_ARROW': {
      const counter = state.counter + 1;
      const id = `el-${counter}`;
      const el: DiagramElement = {
        type: 'flecha',
        id,
        from: clampPoint(action.from),
        to: clampPoint(action.to),
        style: state.nextArrowStyle,
      };
      return {
        ...state,
        elements: [...state.elements, el],
        past: pushPast(state.past, state.elements),
        future: [],
        counter,
        selectedId: id,
      };
    }

    case 'ADD_LINE': {
      const counter = state.counter + 1;
      const id = `el-${counter}`;
      const el: DiagramElement = {
        type: 'linea',
        id,
        points: [clampPoint(action.from), clampPoint(action.to)],
        stroke: state.nextStroke,
      };
      return {
        ...state,
        elements: [...state.elements, el],
        past: pushPast(state.past, state.elements),
        future: [],
        counter,
        selectedId: id,
      };
    }

    case 'ADD_ZONA': {
      const counter = state.counter + 1;
      const id = `el-${counter}`;
      const a = clampPoint(action.from);
      const b = clampPoint(action.to);
      // `fill` solo se guarda si no es null (forma limpia: ausente = contorno).
      const fillProp = state.nextFill ? { fill: state.nextFill } : {};
      const el: DiagramElement = {
        type: 'zona',
        id,
        x_pct: Math.min(a.x_pct, b.x_pct),
        y_pct: Math.min(a.y_pct, b.y_pct),
        w_pct: Math.abs(b.x_pct - a.x_pct),
        h_pct: Math.abs(b.y_pct - a.y_pct),
        stroke: state.nextStroke,
        ...fillProp,
      };
      return {
        ...state,
        elements: [...state.elements, el],
        past: pushPast(state.past, state.elements),
        future: [],
        counter,
        selectedId: id,
      };
    }

    case 'MOVE': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el) return state;
      if (!('x_pct' in el)) return state; // flecha/linea/cota no se mueven por punto
      const moved = { ...el, x_pct: clampPct(action.x_pct), y_pct: clampPct(action.y_pct) };
      const next = state.elements.slice();
      next[idx] = moved;
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    // Traslada un elemento ENTERO por un desplazamiento (drag de dibujados).
    // Acota el delta para que ningún punto de anclaje salga de [0,100] (preserva
    // la forma en vez de distorsionarla en el borde).
    case 'TRANSLATE': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el) return state;
      const anchors = clampAnchors(el);
      const xs = anchors.map((p) => p.x_pct);
      const ys = anchors.map((p) => p.y_pct);
      const dx = Math.max(-Math.min(...xs), Math.min(100 - Math.max(...xs), action.dx));
      const dy = Math.max(-Math.min(...ys), Math.min(100 - Math.max(...ys), action.dy));
      if (dx === 0 && dy === 0) return state;
      const next = state.elements.slice();
      next[idx] = applyTranslate(el, dx, dy);
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'DELETE': {
      if (!state.elements.some((e) => e.id === action.id)) return state;
      return {
        ...state,
        elements: state.elements.filter((e) => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        past: pushPast(state.past, state.elements),
        future: [],
      };
    }

    case 'UPDATE_LABEL': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el || el.type !== 'jugador') return state;
      const label = action.label.trim();
      const updated: DiagramElement = label
        ? { type: 'jugador', id: el.id, x_pct: el.x_pct, y_pct: el.y_pct, role: el.role, label }
        : { type: 'jugador', id: el.id, x_pct: el.x_pct, y_pct: el.y_pct, role: el.role };
      const next = state.elements.slice();
      next[idx] = updated;
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'UPDATE_TEXT': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el || el.type !== 'texto') return state;
      const updated: DiagramElement = { ...el, text: action.text.trim() || DEFAULT_TEXT_LABEL };
      const next = state.elements.slice();
      next[idx] = updated;
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'UPDATE_ARROW_STYLE': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el || el.type !== 'flecha') return state;
      const next = state.elements.slice();
      next[idx] = { ...el, style: action.style };
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'UPDATE_STROKE': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el || (el.type !== 'linea' && el.type !== 'zona')) return state;
      const next = state.elements.slice();
      next[idx] = { ...el, stroke: action.stroke };
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'UPDATE_FILL': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      if (!el || el.type !== 'zona') return state;
      const next = state.elements.slice();
      if (action.fill === null) {
        // Ninguno → se elimina la clave (forma limpia: ausente = contorno).
        const { fill: _drop, ...rest } = el;
        next[idx] = rest;
      } else {
        next[idx] = { ...el, fill: action.fill };
      }
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    case 'UPDATE_SIZE': {
      const idx = state.elements.findIndex((e) => e.id === action.id);
      const el = state.elements[idx];
      // Solo los elementos de PUNTO llevan `size` (= los nombres de POINT_TOOLS).
      if (!el || !(POINT_TOOLS as readonly string[]).includes(el.type)) return state;
      const next = state.elements.slice();
      if (action.size === 'md') {
        // md = default → se elimina la clave (forma limpia).
        const { size: _drop, ...rest } = el as DiagramElement & { size?: ElementSize };
        next[idx] = rest as DiagramElement;
      } else {
        next[idx] = { ...el, size: action.size } as DiagramElement;
      }
      return { ...state, elements: next, past: pushPast(state.past, state.elements), future: [] };
    }

    // ── Historial ─────────────────────────────────────────────────────────────
    case 'UNDO': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        elements: previous,
        past: state.past.slice(0, -1),
        future: [state.elements, ...state.future],
        selectedId: previous.some((e) => e.id === state.selectedId) ? state.selectedId : null,
      };
    }

    case 'REDO': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        elements: next,
        past: pushPast(state.past, state.elements),
        future: state.future.slice(1),
        selectedId: next.some((e) => e.id === state.selectedId) ? state.selectedId : null,
      };
    }

    default:
      return state;
  }
}
