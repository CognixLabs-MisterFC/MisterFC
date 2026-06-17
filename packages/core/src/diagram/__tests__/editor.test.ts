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

// ── PR2 — elementos dibujados (flecha / línea / zona) ───────────────────────

describe('pitchEditorReducer — dibujos (ADD_*)', () => {
  it('ADD_ARROW captura geometría + style de la config; queda seleccionado y válido', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'flecha' },
      { type: 'SET_NEXT_ARROW_STYLE', style: 'conduccion' },
      { type: 'ADD_ARROW', from: { x_pct: 10, y_pct: 20 }, to: { x_pct: 60, y_pct: 70 } },
    );
    expect(s.elements[0]).toMatchObject({
      type: 'flecha',
      from: { x_pct: 10, y_pct: 20 },
      to: { x_pct: 60, y_pct: 70 },
      style: 'conduccion',
    });
    expect(s.selectedId).toBe('el-1');
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('ADD_LINE crea un segmento de 2 puntos con el stroke de la config', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_NEXT_STROKE', stroke: 'dashed' },
      { type: 'ADD_LINE', from: { x_pct: 5, y_pct: 5 }, to: { x_pct: 50, y_pct: 5 } },
    );
    const el = s.elements[0];
    expect(el?.type).toBe('linea');
    expect(el).toMatchObject({ stroke: 'dashed' });
    if (el?.type === 'linea') expect(el.points).toHaveLength(2);
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('ADD_ZONA normaliza esquina→esquina a x/y (mínimos) + w/h (absolutos)', () => {
    const s = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 80, y_pct: 70 }, to: { x_pct: 30, y_pct: 20 } },
    );
    expect(s.elements[0]).toMatchObject({
      type: 'zona',
      x_pct: 30,
      y_pct: 20,
      w_pct: 50,
      h_pct: 50,
      stroke: 'solid',
    });
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('ADD_* clampa las coordenadas fuera de rango', () => {
    const s = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: -10, y_pct: 50 }, to: { x_pct: 130, y_pct: 50 } },
    );
    expect(s.elements[0]).toMatchObject({ from: { x_pct: 0 }, to: { x_pct: 100 } });
  });

  it('SET_NEXT_ARROW_STYLE / SET_NEXT_STROKE no tocan el historial', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_NEXT_ARROW_STYLE', style: 'desmarque' },
      { type: 'SET_NEXT_STROKE', stroke: 'dashed' },
    );
    expect(s.past).toHaveLength(0);
    expect(s.nextArrowStyle).toBe('desmarque');
    expect(s.nextStroke).toBe('dashed');
  });
});

describe('pitchEditorReducer — TRANSLATE de dibujados', () => {
  it('traslada TODOS los puntos de una flecha y acota el delta (preserva forma)', () => {
    const placed = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 30, y_pct: 40 } },
    );
    // dx=-50 se acota a -10 (minX=10); dy=+5 cabe entero.
    const moved = pitchEditorReducer(placed, { type: 'TRANSLATE', id: 'el-1', dx: -50, dy: 5 });
    expect(moved.elements[0]).toMatchObject({
      from: { x_pct: 0, y_pct: 15 },
      to: { x_pct: 20, y_pct: 45 },
    });
    expect(moved.past).toHaveLength(2); // ADD + TRANSLATE
    expect(parseDiagram(toDiagram(moved)).success).toBe(true);
  });

  it('TRANSLATE de una zona mueve su origen y conserva w/h', () => {
    const placed = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 30, y_pct: 30 } },
    );
    const moved = pitchEditorReducer(placed, { type: 'TRANSLATE', id: 'el-1', dx: 5, dy: 5 });
    expect(moved.elements[0]).toMatchObject({ x_pct: 15, y_pct: 15, w_pct: 20, h_pct: 20 });
  });

  it('TRANSLATE sobre id inexistente o delta acotado a 0 es no-op', () => {
    const placed = run(
      initEditorState(),
      { type: 'ADD_LINE', from: { x_pct: 0, y_pct: 0 }, to: { x_pct: 10, y_pct: 10 } },
    );
    expect(pitchEditorReducer(placed, { type: 'TRANSLATE', id: 'nope', dx: 5, dy: 5 })).toBe(placed);
    // minX=0 → dx negativo se acota a 0; dy negativo igual → no-op.
    expect(pitchEditorReducer(placed, { type: 'TRANSLATE', id: 'el-1', dx: -5, dy: -5 })).toBe(placed);
  });
});

describe('pitchEditorReducer — edición de style/stroke', () => {
  it('UPDATE_ARROW_STYLE cambia el estilo de una flecha; no-flecha = no-op', () => {
    const arrow = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 2, y_pct: 2 } },
    );
    const upd = pitchEditorReducer(arrow, { type: 'UPDATE_ARROW_STYLE', id: 'el-1', style: 'desmarque' });
    expect(upd.elements[0]).toMatchObject({ style: 'desmarque' });

    const cono = run(initEditorState(), { type: 'SET_TOOL', tool: 'cono' }, { type: 'PLACE', x_pct: 5, y_pct: 5 });
    expect(pitchEditorReducer(cono, { type: 'UPDATE_ARROW_STYLE', id: 'el-1', style: 'pase' })).toBe(cono);
  });

  it('UPDATE_STROKE cambia el stroke de línea y zona; otro tipo = no-op', () => {
    const linea = run(
      initEditorState(),
      { type: 'ADD_LINE', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 2, y_pct: 2 } },
    );
    expect(
      pitchEditorReducer(linea, { type: 'UPDATE_STROKE', id: 'el-1', stroke: 'dashed' }).elements[0],
    ).toMatchObject({ stroke: 'dashed' });

    const zona = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } },
    );
    expect(
      pitchEditorReducer(zona, { type: 'UPDATE_STROKE', id: 'el-1', stroke: 'dashed' }).elements[0],
    ).toMatchObject({ stroke: 'dashed' });

    const arrow = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 2, y_pct: 2 } },
    );
    expect(pitchEditorReducer(arrow, { type: 'UPDATE_STROKE', id: 'el-1', stroke: 'dashed' })).toBe(arrow);
  });
});

describe('pitchEditorReducer — relleno de la zona (fill verde)', () => {
  it('por defecto la zona no lleva fill (contorno)', () => {
    const s = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 30, y_pct: 30 } },
    );
    expect(s.elements[0]).not.toHaveProperty('fill');
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('SET_NEXT_FILL no toca el historial y dibuja la zona con ese relleno', () => {
    const s = run(
      initEditorState(),
      { type: 'SET_NEXT_FILL', fill: 'green' },
      { type: 'ADD_ZONA', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 30, y_pct: 30 } },
    );
    expect(s.nextFill).toBe('green');
    expect(s.elements[0]).toMatchObject({ type: 'zona', fill: 'green' });
    expect(s.past).toHaveLength(1); // solo ADD_ZONA
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('UPDATE_FILL fija y limpia el relleno (1 paso de undo); no-zona = no-op', () => {
    const zona = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } },
    );
    const green = pitchEditorReducer(zona, { type: 'UPDATE_FILL', id: 'el-1', fill: 'green' });
    expect(green.elements[0]).toMatchObject({ fill: 'green' });
    expect(green.past).toHaveLength(2); // ADD + UPDATE_FILL
    expect(parseDiagram(toDiagram(green)).success).toBe(true);

    const cleared = pitchEditorReducer(green, { type: 'UPDATE_FILL', id: 'el-1', fill: null });
    expect(cleared.elements[0]).not.toHaveProperty('fill');
    expect(parseDiagram(toDiagram(cleared)).success).toBe(true);

    const arrow = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 2, y_pct: 2 } },
    );
    expect(pitchEditorReducer(arrow, { type: 'UPDATE_FILL', id: 'el-1', fill: 'green' })).toBe(arrow);
  });

  it('undo/redo del cambio de relleno', () => {
    const green = run(
      initEditorState(),
      { type: 'ADD_ZONA', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } },
      { type: 'UPDATE_FILL', id: 'el-1', fill: 'green' },
    );
    const undone = pitchEditorReducer(green, { type: 'UNDO' });
    expect(undone.elements[0]).not.toHaveProperty('fill');
    const redone = pitchEditorReducer(undone, { type: 'REDO' });
    expect(redone.elements[0]).toMatchObject({ fill: 'green' });
    expect(parseDiagram(toDiagram(redone)).success).toBe(true);
  });
});

describe('pitchEditorReducer — undo/redo y borrado con dibujados', () => {
  it('deshace/rehace un dibujo y borra elementos dibujados', () => {
    let s = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 20, y_pct: 20 } },
      { type: 'ADD_ZONA', from: { x_pct: 30, y_pct: 30 }, to: { x_pct: 50, y_pct: 50 } },
    );
    expect(s.elements).toHaveLength(2);
    s = pitchEditorReducer(s, { type: 'UNDO' }); // quita la zona
    expect(s.elements).toHaveLength(1);
    s = pitchEditorReducer(s, { type: 'REDO' });
    expect(s.elements).toHaveLength(2);
    s = pitchEditorReducer(s, { type: 'DELETE', id: 'el-1' }); // borra la flecha
    expect(s.elements.map((e) => e.id)).toEqual(['el-2']);
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });
});

// ── Tamaño (size) de elementos de punto ─────────────────────────────────────

describe('pitchEditorReducer — size', () => {
  it('coloca con el tamaño seleccionado; md (default) no añade la clave', () => {
    const lg = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'balon' },
      { type: 'SET_NEXT_SIZE', size: 'lg' },
      { type: 'PLACE', x_pct: 50, y_pct: 50 },
    );
    expect(lg.elements[0]).toMatchObject({ type: 'balon', size: 'lg' });
    expect(parseDiagram(toDiagram(lg)).success).toBe(true);

    const md = place(initEditorState(), 'cono'); // nextSize default md
    expect(md.elements[0]).not.toHaveProperty('size');
  });

  it('SET_NEXT_SIZE no toca el historial', () => {
    const s = run(initEditorState(), { type: 'SET_NEXT_SIZE', size: 'sm' });
    expect(s.past).toHaveLength(0);
    expect(s.nextSize).toBe('sm');
  });

  it('UPDATE_SIZE cambia el tamaño (1 paso) y md elimina la clave', () => {
    const placed = place(initEditorState(), 'jugador');
    const big = pitchEditorReducer(placed, { type: 'UPDATE_SIZE', id: 'el-1', size: 'lg' });
    expect(big.elements[0]).toMatchObject({ size: 'lg' });
    expect(big.past).toHaveLength(2); // PLACE + UPDATE_SIZE
    const back = pitchEditorReducer(big, { type: 'UPDATE_SIZE', id: 'el-1', size: 'md' });
    expect(back.elements[0]).not.toHaveProperty('size');
    expect(parseDiagram(toDiagram(back)).success).toBe(true);
  });

  it('UPDATE_SIZE se deshace/rehace', () => {
    const placed = run(
      initEditorState(),
      { type: 'SET_TOOL', tool: 'aro' },
      { type: 'PLACE', x_pct: 10, y_pct: 10 },
    );
    let s = pitchEditorReducer(placed, { type: 'UPDATE_SIZE', id: 'el-1', size: 'sm' });
    expect(s.elements[0]).toMatchObject({ size: 'sm' });
    s = pitchEditorReducer(s, { type: 'UNDO' });
    expect(s.elements[0]).not.toHaveProperty('size');
    s = pitchEditorReducer(s, { type: 'REDO' });
    expect(s.elements[0]).toMatchObject({ size: 'sm' });
  });

  it('UPDATE_SIZE sobre un elemento dibujado (no-punto) o id inexistente es no-op', () => {
    const arrow = run(
      initEditorState(),
      { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } },
    );
    expect(pitchEditorReducer(arrow, { type: 'UPDATE_SIZE', id: 'el-1', size: 'lg' })).toBe(arrow);
    expect(pitchEditorReducer(arrow, { type: 'UPDATE_SIZE', id: 'nope', size: 'lg' })).toBe(arrow);
  });
});

// F11B.0 — Dibujo libre (ADD_FREEHAND) ----------------------------------------
describe('pitchEditorReducer — ADD_FREEHAND (dibujo libre)', () => {
  const stroke = [
    { x_pct: 5, y_pct: 5 },
    { x_pct: 20, y_pct: 30 },
    { x_pct: 40, y_pct: 10 },
  ];

  it('crea un `linea` con todo el recorrido, 1 paso de undo, queda seleccionado y la salida es válida', () => {
    const s = run(initEditorState(), { type: 'ADD_FREEHAND', points: stroke });
    expect(s.elements).toHaveLength(1);
    const el = s.elements[0]!;
    expect(el.type).toBe('linea');
    if (el.type === 'linea') expect(el.points).toEqual(stroke);
    expect(s.selectedId).toBe('el-1');
    expect(s.past).toHaveLength(1);
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('ignora un trazo de menos de 2 puntos (no-op)', () => {
    const s = initEditorState();
    expect(pitchEditorReducer(s, { type: 'ADD_FREEHAND', points: [{ x_pct: 1, y_pct: 1 }] })).toBe(s);
    expect(pitchEditorReducer(s, { type: 'ADD_FREEHAND', points: [] })).toBe(s);
  });

  it('clampa los puntos fuera de rango a [0,100]', () => {
    const s = run(initEditorState(), {
      type: 'ADD_FREEHAND',
      points: [{ x_pct: -10, y_pct: 50 }, { x_pct: 120, y_pct: 50 }],
    });
    const el = s.elements[0]!;
    if (el.type === 'linea') expect(el.points).toEqual([{ x_pct: 0, y_pct: 50 }, { x_pct: 100, y_pct: 50 }]);
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
  });

  it('undo/redo deshace y rehace el trazo entero', () => {
    let s = run(initEditorState(), { type: 'ADD_FREEHAND', points: stroke });
    s = pitchEditorReducer(s, { type: 'UNDO' });
    expect(s.elements).toHaveLength(0);
    s = pitchEditorReducer(s, { type: 'REDO' });
    expect(s.elements).toHaveLength(1);
    expect(s.elements[0]?.type).toBe('linea');
  });
});

// F11B.1 — CLEAR ("Limpiar todo") --------------------------------------------
describe('pitchEditorReducer — CLEAR', () => {
  it('vacía la escena en 1 paso de undo y conserva el campo', () => {
    let s = place(place(initEditorState(), 'balon', 10, 10), 'cono', 20, 20);
    s = pitchEditorReducer(s, { type: 'SET_FIELD_KIND', kind: 'medio' });
    expect(s.elements).toHaveLength(2);
    s = pitchEditorReducer(s, { type: 'CLEAR' });
    expect(s.elements).toHaveLength(0);
    expect(s.selectedId).toBeNull();
    expect(s.field.kind).toBe('medio');
    // Undo restaura los elementos.
    s = pitchEditorReducer(s, { type: 'UNDO' });
    expect(s.elements).toHaveLength(2);
  });

  it('CLEAR sobre una escena vacía es no-op (no ensucia el historial)', () => {
    const s = initEditorState();
    expect(pitchEditorReducer(s, { type: 'CLEAR' })).toBe(s);
  });
});

// F11B.0 — Color de trazo (flecha / linea / dibujo libre) ---------------------
describe('pitchEditorReducer — color de trazo', () => {
  it('estado inicial sin color (nextColor = null)', () => {
    expect(initEditorState().nextColor).toBeNull();
  });

  it('SET_NEXT_COLOR aplica a flecha, linea y dibujo libre nuevos', () => {
    const base = pitchEditorReducer(initEditorState(), { type: 'SET_NEXT_COLOR', color: 'red' });
    const arrow = pitchEditorReducer(base, { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } });
    expect(arrow.elements[0]).toMatchObject({ type: 'flecha', color: 'red' });

    const line = pitchEditorReducer(base, { type: 'ADD_LINE', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } });
    expect(line.elements[0]).toMatchObject({ type: 'linea', color: 'red' });

    const free = pitchEditorReducer(base, { type: 'ADD_FREEHAND', points: [{ x_pct: 1, y_pct: 1 }, { x_pct: 9, y_pct: 9 }] });
    expect(free.elements[0]).toMatchObject({ type: 'linea', color: 'red' });
  });

  it('sin color seleccionado, la clave NO aparece (ausente = negro)', () => {
    const arrow = run(initEditorState(), { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } });
    expect(arrow.elements[0]).not.toHaveProperty('color');
  });

  it('UPDATE_COLOR fija y limpia el color (null elimina la clave); salida válida', () => {
    let s = run(initEditorState(), { type: 'ADD_ARROW', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 } });
    s = pitchEditorReducer(s, { type: 'UPDATE_COLOR', id: 'el-1', color: 'blue' });
    expect(s.elements[0]).toMatchObject({ color: 'blue' });
    expect(parseDiagram(toDiagram(s)).success).toBe(true);
    s = pitchEditorReducer(s, { type: 'UPDATE_COLOR', id: 'el-1', color: null });
    expect(s.elements[0]).not.toHaveProperty('color');
  });

  it('UPDATE_COLOR sobre un elemento sin color (zona/punto) o id inexistente es no-op', () => {
    const withZona = run(initEditorState(), { type: 'ADD_ZONA', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 30, y_pct: 30 } });
    expect(pitchEditorReducer(withZona, { type: 'UPDATE_COLOR', id: 'el-1', color: 'red' })).toBe(withZona);
    expect(pitchEditorReducer(withZona, { type: 'UPDATE_COLOR', id: 'nope', color: 'red' })).toBe(withZona);
  });
});
