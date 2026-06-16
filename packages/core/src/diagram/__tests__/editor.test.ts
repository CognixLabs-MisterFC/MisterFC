import { describe, it, expect } from 'vitest';
import { parseDiagram, type Diagram } from '../diagram';
import {
  pitchEditorReducer,
  initEditorState,
  toDiagram,
  canUndo,
  canRedo,
  UNDO_LIMIT,
  DEFAULT_TEXT_LABEL,
  POINT_TOOLS,
  type PitchEditorState,
  type PitchAction,
  type PointTool,
} from '../editor';

/** Aplica una secuencia de acciones desde un estado inicial. */
function run(initial: PitchEditorState, ...actions: PitchAction[]): PitchEditorState {
  return actions.reduce(pitchEditorReducer, initial);
}

/** Coloca un elemento de la herramienta dada en (x,y). */
function place(state: PitchEditorState, tool: PointTool, x = 50, y = 50): PitchEditorState {
  return run(state, { type: 'SET_TOOL', tool }, { type: 'PLACE', x_pct: x, y_pct: y });
}

describe('pitchEditorReducer — init', () => {
  it('estado vacío por defecto (campo completo+vertical, sin elementos)', () => {
    const s = initEditorState();
    expect(s.elements).toHaveLength(0);
    expect(s.field).toEqual({ kind: 'completo', orientation: 'vertical' });
    expect(s.tool).toBe('select');
    expect(s.counter).toBe(0);
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it('inicializa desde un Diagram y arranca el contador por encima del id máximo', () => {
    const diagram: Diagram = {
      version: 1,
      field: { kind: 'medio', orientation: 'vertical' },
      elements: [
        { type: 'balon', id: 'el-3', x_pct: 10, y_pct: 10 },
        { type: 'cono', id: 'externo', x_pct: 20, y_pct: 20 },
      ],
    };
    const s = initEditorState(diagram);
    expect(s.field.kind).toBe('medio');
    expect(s.counter).toBe(3);
    // El próximo PLACE no colisiona con el-3.
    const next = place(s, 'aro');
    expect(next.elements.at(-1)?.id).toBe('el-4');
  });
});

describe('pitchEditorReducer — PLACE de cada tipo de punto', () => {
  it.each(POINT_TOOLS)('coloca %s con salida válida y queda seleccionado', (tool) => {
    const s = place(initEditorState(), tool);
    expect(s.elements).toHaveLength(1);
    const el = s.elements[0];
    expect(el?.type).toBe(tool);
    expect(el?.id).toBe('el-1');
    expect(s.selectedId).toBe('el-1');
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('jugador toma rol y etiqueta de la config; sin etiqueta no añade la clave', () => {
    const withLabel = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'jugador' },
      { type: 'SET_NEXT_ROLE', role: 'defensor' },
      { type: 'SET_NEXT_LABEL', label: '10' },
      { type: 'PLACE', x_pct: 40, y_pct: 60 },
    );
    expect(withLabel.elements[0]).toMatchObject({ type: 'jugador', role: 'defensor', label: '10' });

    const noLabel = place(initEditorState(), 'jugador');
    expect(noLabel.elements[0]).not.toHaveProperty('label');
  });

  it('texto usa el texto tecleado, o un default no vacío si está en blanco', () => {
    const typed = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'texto' },
      { type: 'SET_NEXT_TEXT', text: '  Presión  ' },
      { type: 'PLACE', x_pct: 50, y_pct: 50 },
    );
    expect(typed.elements[0]).toMatchObject({ type: 'texto', text: 'Presión' });

    const blank = place(initEditorState(), 'texto');
    expect(blank.elements[0]).toMatchObject({ type: 'texto', text: DEFAULT_TEXT_LABEL });
    expect(parseDiagram(toDiagram(blank)).success).toBe(true);
  });

  it('clampa las coordenadas fuera de rango a 0–100', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'balon' },
      { type: 'PLACE', x_pct: 150, y_pct: -20 },
    );
    expect(s.elements[0]).toMatchObject({ x_pct: 100, y_pct: 0 });
  });

  it('PLACE en modo selección no hace nada', () => {
    const s = pitchEditorReducer(initEditorState(), { type: 'PLACE', x_pct: 10, y_pct: 10 });
    expect(s.elements).toHaveLength(0);
  });
});

describe('pitchEditorReducer — MOVE / DELETE', () => {
  it('MOVE actualiza la posición y clampa (un paso de historial)', () => {
    const placed = place(initEditorState(), 'cono', 20, 20);
    const moved = pitchEditorReducer(placed, { type: 'MOVE', id: 'el-1', x_pct: 130, y_pct: 70 });
    expect(moved.elements[0]).toMatchObject({ x_pct: 100, y_pct: 70 });
    expect(moved.past).toHaveLength(2); // PLACE + MOVE
  });

  it('MOVE sobre id inexistente es no-op', () => {
    const placed = place(initEditorState(), 'cono');
    const same = pitchEditorReducer(placed, { type: 'MOVE', id: 'nope', x_pct: 1, y_pct: 1 });
    expect(same).toBe(placed);
  });

  it('DELETE quita el elemento y limpia la selección', () => {
    const placed = place(initEditorState(), 'aro');
    const deleted = pitchEditorReducer(placed, { type: 'DELETE', id: 'el-1' });
    expect(deleted.elements).toHaveLength(0);
    expect(deleted.selectedId).toBeNull();
  });

  it('DELETE sobre id inexistente es no-op', () => {
    const placed = place(initEditorState(), 'aro');
    expect(pitchEditorReducer(placed, { type: 'DELETE', id: 'nope' })).toBe(placed);
  });
});

describe('pitchEditorReducer — edición de textos libres', () => {
  it('UPDATE_LABEL pone/quita la etiqueta de un jugador', () => {
    const placed = place(initEditorState(), 'jugador');
    const set = pitchEditorReducer(placed, { type: 'UPDATE_LABEL', id: 'el-1', label: '  7 ' });
    expect(set.elements[0]).toMatchObject({ label: '7' });
    const cleared = pitchEditorReducer(set, { type: 'UPDATE_LABEL', id: 'el-1', label: '   ' });
    expect(cleared.elements[0]).not.toHaveProperty('label');
    expect(parseDiagram(toDiagram(cleared)).success).toBe(true);
  });

  it('UPDATE_LABEL sobre un no-jugador es no-op', () => {
    const placed = place(initEditorState(), 'balon');
    expect(pitchEditorReducer(placed, { type: 'UPDATE_LABEL', id: 'el-1', label: 'x' })).toBe(placed);
  });

  it('UPDATE_TEXT cambia el texto; en blanco cae al default (nunca vacío)', () => {
    const placed = place(initEditorState(), 'texto');
    const set = pitchEditorReducer(placed, { type: 'UPDATE_TEXT', id: 'el-1', text: 'Salida' });
    expect(set.elements[0]).toMatchObject({ text: 'Salida' });
    const blank = pitchEditorReducer(set, { type: 'UPDATE_TEXT', id: 'el-1', text: '  ' });
    expect(blank.elements[0]).toMatchObject({ text: DEFAULT_TEXT_LABEL });
  });
});

describe('pitchEditorReducer — cambios fuera del historial', () => {
  it('SET_TOOL / SET_FIELD_KIND / SELECT / SET_NEXT_* no tocan el historial', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'jugador' },
      { type: 'SET_FIELD_KIND', kind: 'medio' },
      { type: 'SET_NEXT_ROLE', role: 'portero' },
      { type: 'SET_NEXT_LABEL', label: 'GK' },
      { type: 'SET_NEXT_TEXT', text: 'hola' },
      { type: 'SELECT', id: null },
    );
    expect(s.past).toHaveLength(0);
    expect(s.field.kind).toBe('medio');
    expect(canUndo(s)).toBe(false);
  });

  it('SELECT de un id inexistente deja la selección en null', () => {
    const s = pitchEditorReducer(initEditorState(), { type: 'SELECT', id: 'nope' });
    expect(s.selectedId).toBeNull();
  });
});

describe('pitchEditorReducer — undo/redo', () => {
  it('deshace y rehace una colocación', () => {
    const placed = place(initEditorState(), 'balon');
    const undone = pitchEditorReducer(placed, { type: 'UNDO' });
    expect(undone.elements).toHaveLength(0);
    expect(canRedo(undone)).toBe(true);
    const redone = pitchEditorReducer(undone, { type: 'REDO' });
    expect(redone.elements).toHaveLength(1);
  });

  it('UNDO con historial vacío y REDO sin futuro son no-op', () => {
    const s = initEditorState();
    expect(pitchEditorReducer(s, { type: 'UNDO' })).toBe(s);
    const placed = place(s, 'cono');
    expect(pitchEditorReducer(placed, { type: 'REDO' })).toBe(placed);
  });

  it('una nueva mutación tras deshacer descarta el futuro', () => {
    let s = place(initEditorState(), 'balon'); // el-1
    s = pitchEditorReducer(s, { type: 'UNDO' });
    expect(canRedo(s)).toBe(true);
    s = place(s, 'cono'); // nueva mutación
    expect(canRedo(s)).toBe(false);
  });

  it('el contador NO se reduce al deshacer (no reutiliza ids al rehacer/colocar)', () => {
    let s = place(initEditorState(), 'balon'); // el-1
    s = pitchEditorReducer(s, { type: 'UNDO' });
    s = place(s, 'cono'); // debe ser el-2, no el-1
    expect(s.elements.at(-1)?.id).toBe('el-2');
  });

  it('respeta el tope UNDO_LIMIT', () => {
    let s = initEditorState();
    s = pitchEditorReducer(s, { type: 'SET_TOOL', tool: 'balon' });
    for (let i = 0; i < UNDO_LIMIT + 10; i++) {
      s = pitchEditorReducer(s, { type: 'PLACE', x_pct: 10, y_pct: 10 });
    }
    expect(s.past.length).toBe(UNDO_LIMIT);
    expect(s.elements.length).toBe(UNDO_LIMIT + 10);
  });

  it('la salida valida con parseDiagram tras una secuencia mixta', () => {
    let s = initEditorState();
    s = place(s, 'jugador', 30, 80);
    s = place(s, 'porteria', 50, 5);
    s = place(s, 'texto', 80, 20);
    s = pitchEditorReducer(s, { type: 'MOVE', id: 'el-1', x_pct: 35, y_pct: 75 });
    s = pitchEditorReducer(s, { type: 'DELETE', id: 'el-2' });
    s = pitchEditorReducer(s, { type: 'UNDO' });
    s = pitchEditorReducer(s, { type: 'REDO' });
    const parsed = parseDiagram(toDiagram(s));
    expect(parsed.success).toBe(true);
  });
});
