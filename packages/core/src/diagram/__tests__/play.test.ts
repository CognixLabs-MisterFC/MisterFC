import { describe, it, expect } from 'vitest';
import {
  PLAY_VERSION,
  DEFAULT_FRAME_MS,
  MAX_FRAMES,
  MIN_FRAME_MS,
  MAX_FRAME_MS,
  parsePlay,
  isPlay,
  emptyPlay,
  addFrame,
  playDurationMs,
  sceneAtTime,
  type Play,
  type PlayFrame,
  type SceneElement,
} from '../play';
import type { DiagramElement } from '../diagram';

// ── Helpers de construcción ───────────────────────────────────────────────────
const jugador = (id: string, x: number, y: number, extra: Partial<DiagramElement> = {}): DiagramElement =>
  ({ type: 'jugador', id, x_pct: x, y_pct: y, role: 'atacante', ...extra }) as DiagramElement;
const flecha = (id: string, from: [number, number], to: [number, number]): DiagramElement => ({
  type: 'flecha',
  id,
  from: { x_pct: from[0], y_pct: from[1] },
  to: { x_pct: to[0], y_pct: to[1] },
  style: 'pase',
});
const frame = (elements: DiagramElement[], duration_ms?: number): PlayFrame =>
  duration_ms == null ? { elements } : { elements, duration_ms };
const mkPlay = (frames: PlayFrame[]): Play => ({
  version: PLAY_VERSION,
  field: { kind: 'completo', orientation: 'vertical' },
  frames,
});
const byId = (els: SceneElement[], id: string) => els.find((e) => e.id === id);

// ── Schema ─────────────────────────────────────────────────────────────────
describe('playSchema / parsePlay', () => {
  it('emptyPlay() es válida: version, field, 1 frame vacío', () => {
    const p = emptyPlay();
    expect(p.version).toBe(PLAY_VERSION);
    expect(p.frames).toHaveLength(1);
    expect(parsePlay(p).success).toBe(true);
  });

  it('emptyPlay respeta el field parcial', () => {
    const p = emptyPlay({ kind: 'medio' });
    expect(p.field.kind).toBe('medio');
    expect(p.field.orientation).toBe('vertical');
  });

  it('rechaza 0 frames y acepta el tope MAX_FRAMES', () => {
    expect(parsePlay(mkPlay([])).success).toBe(false);
    const max = mkPlay(Array.from({ length: MAX_FRAMES }, () => frame([])));
    expect(parsePlay(max).success).toBe(true);
    const over = mkPlay(Array.from({ length: MAX_FRAMES + 1 }, () => frame([])));
    expect(parsePlay(over).success).toBe(false);
  });

  it('valida ids únicos DENTRO de un frame', () => {
    const dup = mkPlay([frame([jugador('p1', 1, 1), jugador('p1', 2, 2)])]);
    expect(parsePlay(dup).success).toBe(false);
  });

  it('permite el MISMO id en frames distintos (es "el mismo" elemento)', () => {
    const p = mkPlay([frame([jugador('p1', 0, 0)]), frame([jugador('p1', 50, 50)])]);
    expect(parsePlay(p).success).toBe(true);
  });

  it('retrocompat: elementos sin `color` son válidos', () => {
    const p = mkPlay([frame([flecha('a1', [0, 0], [10, 10])])]);
    expect(parsePlay(p).success).toBe(true);
  });

  it('valida el rango de duration_ms por frame', () => {
    expect(parsePlay(mkPlay([frame([], MIN_FRAME_MS), frame([])])).success).toBe(true);
    expect(parsePlay(mkPlay([frame([], MAX_FRAME_MS), frame([])])).success).toBe(true);
    expect(parsePlay(mkPlay([frame([], MIN_FRAME_MS - 1), frame([])])).success).toBe(false);
    expect(parsePlay(mkPlay([frame([], MAX_FRAME_MS + 1), frame([])])).success).toBe(false);
  });

  it('exige version = PLAY_VERSION', () => {
    expect(parsePlay({ ...emptyPlay(), version: 2 }).success).toBe(false);
  });

  it('isPlay: type guard', () => {
    expect(isPlay(emptyPlay())).toBe(true);
    expect(isPlay({ nope: true })).toBe(false);
  });
});

// ── addFrame ─────────────────────────────────────────────────────────────────
describe('addFrame', () => {
  it('añade un frame al final sin mutar la jugada original', () => {
    const p0 = emptyPlay();
    const p1 = addFrame(p0, frame([jugador('p1', 5, 5)]));
    expect(p0.frames).toHaveLength(1); // intacta
    expect(p1.frames).toHaveLength(2);
    expect(p1.frames[1]?.elements).toHaveLength(1);
  });
  it('por defecto añade un frame vacío', () => {
    expect(addFrame(emptyPlay()).frames[1]?.elements).toEqual([]);
  });
});

// ── playDurationMs ───────────────────────────────────────────────────────────
describe('playDurationMs', () => {
  it('1 frame → 0 (no hay transición)', () => {
    expect(playDurationMs(mkPlay([frame([])]))).toBe(0);
  });
  it('default global por frame sin duration_ms (suma de n-1 transiciones)', () => {
    const p = mkPlay([frame([]), frame([]), frame([])]); // 3 frames → 2 transiciones
    expect(playDurationMs(p)).toBe(2 * DEFAULT_FRAME_MS);
  });
  it('suma duration_ms por frame; el del ÚLTIMO frame NO cuenta', () => {
    const p = mkPlay([frame([], 500), frame([], 300), frame([], 9999)]);
    // 500 (f0→f1) + 300 (f1→f2); 9999 del último se ignora.
    expect(playDurationMs(p)).toBe(800);
  });
  it('mezcla: frames con y sin duration_ms', () => {
    const p = mkPlay([frame([], 200), frame([]), frame([])]);
    expect(playDurationMs(p)).toBe(200 + DEFAULT_FRAME_MS);
  });
});

// ── sceneAtTime ──────────────────────────────────────────────────────────────
describe('sceneAtTime — posiciones / props / fade / límites', () => {
  it('1 frame: siempre la escena estática de ese frame', () => {
    const p = mkPlay([frame([jugador('p1', 10, 20)])]);
    const s = sceneAtTime(p, 12345);
    expect(s.version).toBe(1);
    expect(byId(s.elements, 'p1')).toMatchObject({ x_pct: 10, y_pct: 20 });
    expect(byId(s.elements, 'p1')?.opacity).toBeUndefined();
  });

  it('interpola posiciones por id con lerp lineal (t medio)', () => {
    const p = mkPlay([frame([jugador('p1', 0, 0)], 1000), frame([jugador('p1', 40, 80)])]);
    const s = sceneAtTime(p, 500); // p = 0.5
    expect(byId(s.elements, 'p1')).toMatchObject({ x_pct: 20, y_pct: 40 });
  });

  it('interpola las DOS anclas de una flecha', () => {
    const p = mkPlay([
      frame([flecha('a1', [0, 0], [10, 10])], 1000),
      frame([flecha('a1', [20, 20], [30, 50])]),
    ]);
    const s = sceneAtTime(p, 500);
    const a = byId(s.elements, 'a1') as Extract<DiagramElement, { type: 'flecha' }>;
    expect(a.from).toEqual({ x_pct: 10, y_pct: 10 });
    expect(a.to).toEqual({ x_pct: 20, y_pct: 30 });
  });

  it('props discretas SALTAN: toma las del ORIGEN durante la transición', () => {
    const p = mkPlay([
      frame([jugador('p1', 0, 0, { role: 'atacante', label: 'A' })], 1000),
      frame([jugador('p1', 10, 0, { role: 'defensor', label: 'B' })]),
    ]);
    const mid = byId(sceneAtTime(p, 500).elements, 'p1') as Extract<DiagramElement, { type: 'jugador' }>;
    expect(mid.role).toBe('atacante'); // del origen, no interpola
    expect(mid.label).toBe('A');
    expect(mid.x_pct).toBe(5); // posición sí interpola
    // al llegar al destino (t≥total) ya muestra las props del último frame
    const end = byId(sceneAtTime(p, 1000).elements, 'p1') as Extract<DiagramElement, { type: 'jugador' }>;
    expect(end.role).toBe('defensor');
    expect(end.label).toBe('B');
  });

  it('fade-out: elemento solo en el origen → opacity 1→0', () => {
    const p = mkPlay([frame([jugador('g1', 5, 5)], 1000), frame([jugador('p1', 5, 5)])]);
    expect(byId(sceneAtTime(p, 250).elements, 'g1')?.opacity).toBeCloseTo(0.75);
    expect(byId(sceneAtTime(p, 750).elements, 'g1')?.opacity).toBeCloseTo(0.25);
  });

  it('fade-in: elemento solo en el destino → opacity 0→1', () => {
    const p = mkPlay([frame([jugador('p1', 5, 5)], 1000), frame([jugador('n1', 9, 9)])]);
    expect(byId(sceneAtTime(p, 250).elements, 'n1')?.opacity).toBeCloseTo(0.25);
    expect(byId(sceneAtTime(p, 750).elements, 'n1')?.opacity).toBeCloseTo(0.75);
  });

  it('t ≤ 0 → primer frame estático (sin opacity, sin elementos del destino)', () => {
    const p = mkPlay([frame([jugador('p1', 0, 0)], 1000), frame([jugador('n1', 9, 9)])]);
    const s = sceneAtTime(p, 0);
    expect(byId(s.elements, 'p1')).toMatchObject({ x_pct: 0, y_pct: 0 });
    expect(byId(s.elements, 'p1')?.opacity).toBeUndefined();
    expect(byId(s.elements, 'n1')).toBeUndefined();
    expect(sceneAtTime(p, -100).elements).toHaveLength(1);
  });

  it('t ≥ total → último frame estático', () => {
    const p = mkPlay([frame([jugador('p1', 0, 0)], 1000), frame([jugador('p1', 40, 80)])]);
    const s = sceneAtTime(p, 999999);
    expect(byId(s.elements, 'p1')).toMatchObject({ x_pct: 40, y_pct: 80 });
    expect(byId(s.elements, 'p1')?.opacity).toBeUndefined();
  });

  it('t en un límite INTERNO de frame (p=0) muestra ese frame', () => {
    const p = mkPlay([
      frame([jugador('p1', 0, 0)], 1000),
      frame([jugador('p1', 30, 0)], 1000),
      frame([jugador('p1', 90, 0)]),
    ]); // total 2000, límite interno en t=1000
    const at = byId(sceneAtTime(p, 1000).elements, 'p1');
    expect(at).toMatchObject({ x_pct: 30, y_pct: 0 }); // posición exacta del frame 1
  });

  it('usa la duración por defecto cuando el frame no la trae', () => {
    const p = mkPlay([frame([jugador('p1', 0, 0)]), frame([jugador('p1', 100, 0)])]);
    // sin duration_ms → DEFAULT_FRAME_MS; a mitad (DEFAULT/2) → x = 50
    const mid = byId(sceneAtTime(p, DEFAULT_FRAME_MS / 2).elements, 'p1') as Extract<
      DiagramElement,
      { type: 'jugador' }
    >;
    expect(mid.x_pct).toBeCloseTo(50);
  });

  it('linea con DISTINTO nº de puntos entre frames → no interpola geometría (usa el origen)', () => {
    const src: DiagramElement = {
      type: 'linea',
      id: 'l1',
      points: [
        { x_pct: 0, y_pct: 0 },
        { x_pct: 10, y_pct: 10 },
      ],
    };
    const dst: DiagramElement = {
      type: 'linea',
      id: 'l1',
      points: [
        { x_pct: 50, y_pct: 50 },
        { x_pct: 60, y_pct: 60 },
        { x_pct: 70, y_pct: 70 },
      ],
    };
    const p = mkPlay([frame([src], 1000), frame([dst])]);
    const at = byId(sceneAtTime(p, 500).elements, 'l1') as Extract<DiagramElement, { type: 'linea' }>;
    expect(at.points).toEqual(src.points); // sin interpolar
  });

  it('linea con MISMO nº de puntos → interpola cada punto', () => {
    const src: DiagramElement = { type: 'linea', id: 'l1', points: [{ x_pct: 0, y_pct: 0 }, { x_pct: 0, y_pct: 0 }] };
    const dst: DiagramElement = { type: 'linea', id: 'l1', points: [{ x_pct: 20, y_pct: 40 }, { x_pct: 60, y_pct: 80 }] };
    const p = mkPlay([frame([src], 1000), frame([dst])]);
    const at = byId(sceneAtTime(p, 500).elements, 'l1') as Extract<DiagramElement, { type: 'linea' }>;
    expect(at.points).toEqual([{ x_pct: 10, y_pct: 20 }, { x_pct: 30, y_pct: 40 }]);
  });

  it('el field de la escena es el de la jugada', () => {
    const p: Play = { version: PLAY_VERSION, field: { kind: 'medio', orientation: 'vertical' }, frames: [frame([])] };
    expect(sceneAtTime(p, 0).field).toEqual({ kind: 'medio', orientation: 'vertical' });
  });
});
