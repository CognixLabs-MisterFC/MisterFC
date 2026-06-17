import { describe, it, expect } from 'vitest';
import {
  parseDiagram,
  isDiagram,
  emptyDiagram,
  elementAnchors,
  diagramElementSchema,
  DIAGRAM_VERSION,
  MAX_DIAGRAM_ELEMENTS,
  type Diagram,
  type DiagramElement,
} from '../diagram';

// Una escena con UN elemento de cada tipo (ids únicos).
function fullScene(): Diagram {
  const elements: DiagramElement[] = [
    { type: 'jugador', id: 'j1', x_pct: 10, y_pct: 20, role: 'atacante', label: 'A' },
    { type: 'jugador', id: 'j2', x_pct: 12, y_pct: 22, role: 'portero' },
    { type: 'balon', id: 'b1', x_pct: 50, y_pct: 50 },
    { type: 'cono', id: 'c1', x_pct: 0, y_pct: 0 },
    { type: 'aro', id: 'a1', x_pct: 100, y_pct: 100 },
    { type: 'gol_conduccion', id: 'g1', x_pct: 30, y_pct: 90 },
    { type: 'porteria', id: 'p1', x_pct: 50, y_pct: 0, rotation: 90 },
    { type: 'miniporteria', id: 'm1', x_pct: 25, y_pct: 5 },
    { type: 'texto', id: 't1', x_pct: 40, y_pct: 40, text: 'B' },
    { type: 'flecha', id: 'f1', from: { x_pct: 10, y_pct: 10 }, to: { x_pct: 80, y_pct: 80 }, style: 'pase' },
    { type: 'linea', id: 'l1', points: [{ x_pct: 0, y_pct: 0 }, { x_pct: 50, y_pct: 50 }], stroke: 'dashed' },
    { type: 'zona', id: 'z1', x_pct: 10, y_pct: 10, w_pct: 30, h_pct: 20, stroke: 'dashed' },
    { type: 'cota', id: 'cota1', from: { x_pct: 0, y_pct: 0 }, to: { x_pct: 40, y_pct: 0 }, label: '40 m' },
  ];
  return { version: DIAGRAM_VERSION, field: { kind: 'completo', orientation: 'vertical' }, elements };
}

describe('diagramSchema — happy path', () => {
  it('acepta una escena con todos los tipos de elemento', () => {
    const r = parseDiagram(fullScene());
    expect(r.success).toBe(true);
  });

  it('acepta una escena vacía', () => {
    const r = parseDiagram(emptyDiagram());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.elements).toEqual([]);
  });

  it('emptyDiagram aplica defaults (completo + vertical) y respeta overrides', () => {
    expect(emptyDiagram().field).toEqual({ kind: 'completo', orientation: 'vertical' });
    expect(emptyDiagram({ kind: 'medio', orientation: 'horizontal' }).field).toEqual({
      kind: 'medio',
      orientation: 'horizontal',
    });
  });

  it('field.orientation por defecto = vertical cuando se omite', () => {
    const r = parseDiagram({
      version: DIAGRAM_VERSION,
      field: { kind: 'medio' },
      elements: [],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.field.orientation).toBe('vertical');
  });

  it('isDiagram actúa como type guard', () => {
    expect(isDiagram(fullScene())).toBe(true);
    expect(isDiagram({ nope: true })).toBe(false);
  });
});

describe('diagramElementSchema — por tipo', () => {
  it('valida cada tipo individualmente', () => {
    for (const el of fullScene().elements) {
      expect(diagramElementSchema.safeParse(el).success).toBe(true);
    }
  });

  it('rechaza un type inexistente', () => {
    const r = diagramElementSchema.safeParse({ type: 'extraterrestre', id: 'x', x_pct: 1, y_pct: 1 });
    expect(r.success).toBe(false);
  });

  it('jugador exige role del vocabulario', () => {
    expect(
      diagramElementSchema.safeParse({ type: 'jugador', id: 'j', x_pct: 1, y_pct: 1, role: 'mediocentro' })
        .success,
    ).toBe(false);
  });

  it('flecha usa style semántico (español); rechaza valor fuera del vocabulario', () => {
    const ok = diagramElementSchema.safeParse({
      type: 'flecha', id: 'f', from: { x_pct: 0, y_pct: 0 }, to: { x_pct: 1, y_pct: 1 }, style: 'desmarque',
    });
    expect(ok.success).toBe(true);
    const bad = diagramElementSchema.safeParse({
      type: 'flecha', id: 'f', from: { x_pct: 0, y_pct: 0 }, to: { x_pct: 1, y_pct: 1 }, style: 'dashed',
    });
    expect(bad.success).toBe(false); // 'dashed' es stroke visual, no semántica de flecha
  });

  it('zona/linea usan stroke visual (inglés); el stroke de la línea es opcional', () => {
    expect(
      diagramElementSchema.safeParse({ type: 'linea', id: 'l', points: [{ x_pct: 0, y_pct: 0 }, { x_pct: 1, y_pct: 1 }] })
        .success,
    ).toBe(true); // sin stroke
    expect(
      diagramElementSchema.safeParse({ type: 'zona', id: 'z', x_pct: 0, y_pct: 0, w_pct: 10, h_pct: 10, stroke: 'pase' })
        .success,
    ).toBe(false); // 'pase' es semántica, no stroke
  });

  it('linea exige al menos 2 puntos', () => {
    expect(
      diagramElementSchema.safeParse({ type: 'linea', id: 'l', points: [{ x_pct: 0, y_pct: 0 }] }).success,
    ).toBe(false);
  });
});

describe('diagramSchema — rangos y límites', () => {
  it('rechaza coords fuera de [0,100]', () => {
    const scene = emptyDiagram();
    scene.elements.push({ type: 'balon', id: 'b', x_pct: 101, y_pct: 50 });
    expect(parseDiagram(scene).success).toBe(false);

    const neg = emptyDiagram();
    neg.elements.push({ type: 'balon', id: 'b', x_pct: -1, y_pct: 50 });
    expect(parseDiagram(neg).success).toBe(false);
  });

  it('rechaza una zona que no cabe en el campo', () => {
    const scene = emptyDiagram();
    scene.elements.push({ type: 'zona', id: 'z', x_pct: 80, y_pct: 0, w_pct: 30, h_pct: 10, stroke: 'solid' });
    expect(parseDiagram(scene).success).toBe(false); // 80 + 30 > 100
  });

  it('rechaza una zona sin área (w/h = 0)', () => {
    const scene = emptyDiagram();
    scene.elements.push({ type: 'zona', id: 'z', x_pct: 10, y_pct: 10, w_pct: 0, h_pct: 10, stroke: 'solid' });
    expect(parseDiagram(scene).success).toBe(false);
  });

  it('rechaza ids duplicados dentro de la escena', () => {
    const scene = emptyDiagram();
    scene.elements.push({ type: 'cono', id: 'dup', x_pct: 1, y_pct: 1 });
    scene.elements.push({ type: 'aro', id: 'dup', x_pct: 2, y_pct: 2 });
    const r = parseDiagram(scene);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'duplicate_id')).toBe(true);
    }
  });

  it('acepta exactamente MAX_DIAGRAM_ELEMENTS y rechaza uno más', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i): DiagramElement => ({
        type: 'cono', id: `c${i}`, x_pct: 1, y_pct: 1,
      }));
    const okScene: Diagram = { version: DIAGRAM_VERSION, field: { kind: 'completo', orientation: 'vertical' }, elements: mk(MAX_DIAGRAM_ELEMENTS) };
    expect(parseDiagram(okScene).success).toBe(true);
    const tooMany: Diagram = { ...okScene, elements: mk(MAX_DIAGRAM_ELEMENTS + 1) };
    expect(parseDiagram(tooMany).success).toBe(false);
  });

  it('rechaza una version distinta de la del contrato', () => {
    const r = parseDiagram({ version: 2, field: { kind: 'completo', orientation: 'vertical' }, elements: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza field ausente', () => {
    const r = parseDiagram({ version: DIAGRAM_VERSION, elements: [] });
    expect(r.success).toBe(false);
  });
});

describe('elementAnchors — seam de frames (posición separable)', () => {
  it('devuelve el punto único de los elementos puntuales', () => {
    expect(elementAnchors({ type: 'balon', id: 'b', x_pct: 7, y_pct: 8 })).toEqual([{ x_pct: 7, y_pct: 8 }]);
    expect(elementAnchors({ type: 'jugador', id: 'j', x_pct: 3, y_pct: 4, role: 'defensor' })).toEqual([
      { x_pct: 3, y_pct: 4 },
    ]);
    expect(elementAnchors({ type: 'zona', id: 'z', x_pct: 1, y_pct: 2, w_pct: 5, h_pct: 5, stroke: 'solid' })).toEqual([
      { x_pct: 1, y_pct: 2 },
    ]);
  });

  it('devuelve from/to en flecha y cota', () => {
    expect(
      elementAnchors({ type: 'flecha', id: 'f', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 2, y_pct: 2 }, style: 'pase' }),
    ).toEqual([{ x_pct: 1, y_pct: 1 }, { x_pct: 2, y_pct: 2 }]);
    expect(
      elementAnchors({ type: 'cota', id: 'c', from: { x_pct: 0, y_pct: 0 }, to: { x_pct: 9, y_pct: 0 }, label: '9 m' }),
    ).toEqual([{ x_pct: 0, y_pct: 0 }, { x_pct: 9, y_pct: 0 }]);
  });

  it('devuelve todos los puntos de una línea', () => {
    const pts = [{ x_pct: 0, y_pct: 0 }, { x_pct: 5, y_pct: 5 }, { x_pct: 10, y_pct: 0 }];
    expect(elementAnchors({ type: 'linea', id: 'l', points: pts })).toEqual(pts);
  });
});

// ── Tamaño de elemento (size, aditivo y retrocompatible) ────────────────────

describe('parseDiagram — size de elementos de punto', () => {
  const base: Diagram = { version: DIAGRAM_VERSION, field: { kind: 'completo', orientation: 'vertical' }, elements: [] };

  it('acepta un elemento de punto SIN size (retrocompatible)', () => {
    const d: Diagram = { ...base, elements: [{ type: 'balon', id: 'b1', x_pct: 50, y_pct: 50 }] };
    expect(parseDiagram(d).success).toBe(true);
  });

  it('acepta size sm/md/lg en cada tipo de punto', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const d: Diagram = {
        ...base,
        elements: [
          { type: 'jugador', id: 'j', x_pct: 10, y_pct: 10, role: 'atacante', size },
          { type: 'cono', id: 'c', x_pct: 20, y_pct: 20, size },
          { type: 'texto', id: 't', x_pct: 30, y_pct: 30, text: 'X', size },
        ],
      };
      expect(parseDiagram(d).success).toBe(true);
    }
  });

  it('rechaza un size inválido', () => {
    const d = {
      ...base,
      elements: [{ type: 'balon', id: 'b1', x_pct: 50, y_pct: 50, size: 'xl' }],
    };
    expect(parseDiagram(d).success).toBe(false);
  });
});

// ── Relleno de la zona (fill, aditivo y retrocompatible) ────────────────────

describe('parseDiagram — relleno de la zona', () => {
  const base: Diagram = { version: DIAGRAM_VERSION, field: { kind: 'completo', orientation: 'vertical' }, elements: [] };
  const zona = (extra: Record<string, unknown>) => ({
    ...base,
    elements: [{ type: 'zona', id: 'z', x_pct: 10, y_pct: 10, w_pct: 20, h_pct: 20, stroke: 'solid', ...extra }],
  });

  it('acepta una zona SIN fill (retrocompatible: contorno)', () => {
    expect(parseDiagram(zona({})).success).toBe(true);
  });

  it('acepta una zona con fill="green"', () => {
    expect(parseDiagram(zona({ fill: 'green' })).success).toBe(true);
  });

  it('rechaza un fill inválido', () => {
    expect(parseDiagram(zona({ fill: 'rojo' })).success).toBe(false);
    expect(parseDiagram(zona({ fill: true })).success).toBe(false);
  });
});

// F11B.0 — color de trazo opcional en flecha y linea (aditivo, retrocompat).
describe('color de trazo (F11B.0)', () => {
  const flecha = (extra: Record<string, unknown> = {}) => ({
    version: DIAGRAM_VERSION,
    field: { kind: 'completo', orientation: 'vertical' },
    elements: [
      { type: 'flecha', id: 'f1', from: { x_pct: 1, y_pct: 1 }, to: { x_pct: 9, y_pct: 9 }, style: 'pase', ...extra },
    ],
  });
  const linea = (extra: Record<string, unknown> = {}) => ({
    version: DIAGRAM_VERSION,
    field: { kind: 'completo', orientation: 'vertical' },
    elements: [
      { type: 'linea', id: 'l1', points: [{ x_pct: 1, y_pct: 1 }, { x_pct: 9, y_pct: 9 }], ...extra },
    ],
  });

  it('acepta flecha/linea SIN color (retrocompatible)', () => {
    expect(parseDiagram(flecha()).success).toBe(true);
    expect(parseDiagram(linea()).success).toBe(true);
  });

  it('acepta color blue/red en flecha y linea', () => {
    for (const c of ['blue', 'red'] as const) {
      expect(parseDiagram(flecha({ color: c })).success).toBe(true);
      expect(parseDiagram(linea({ color: c })).success).toBe(true);
    }
  });

  it('rechaza un color inválido', () => {
    expect(parseDiagram(flecha({ color: 'black' })).success).toBe(false); // negro = ausencia, no valor
    expect(parseDiagram(flecha({ color: 'verde' })).success).toBe(false);
    expect(parseDiagram(linea({ color: 'azul' })).success).toBe(false);
    expect(parseDiagram(linea({ color: true })).success).toBe(false);
  });

  it('color NO es válido en otros elementos (zona)', () => {
    const zonaConColor = {
      version: DIAGRAM_VERSION,
      field: { kind: 'completo', orientation: 'vertical' },
      elements: [
        { type: 'zona', id: 'z1', x_pct: 10, y_pct: 10, w_pct: 20, h_pct: 20, stroke: 'solid', color: 'blue' },
      ],
    };
    // El campo extra `color` se descarta (no rompe), pero no queda en el dato.
    const res = parseDiagram(zonaConColor);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.elements[0]).not.toHaveProperty('color');
  });
});
