import { describe, it, expect } from 'vitest';
import { simplifyStroke, DEFAULT_SIMPLIFY_EPSILON } from '../simplify';
import { MAX_LINE_POINTS, type DiagramPoint } from '../diagram';

const p = (x: number, y: number): DiagramPoint => ({ x_pct: x, y_pct: y });

describe('simplifyStroke', () => {
  it('deja intactos los trazos de 0/1/2 puntos', () => {
    expect(simplifyStroke([])).toEqual([]);
    expect(simplifyStroke([p(1, 1)])).toEqual([p(1, 1)]);
    expect(simplifyStroke([p(1, 1), p(9, 9)])).toEqual([p(1, 1), p(9, 9)]);
  });

  it('colapsa puntos casi colineales a los extremos', () => {
    // 5 puntos sobre una recta → quedan 2 (inicio y fin).
    const line = [p(0, 0), p(2.5, 2.5), p(5, 5), p(7.5, 7.5), p(10, 10)];
    const out = simplifyStroke(line);
    expect(out).toEqual([p(0, 0), p(10, 10)]);
  });

  it('conserva un vértice cuando la desviación supera epsilon', () => {
    // Pico en (5,10): la desviación respecto a la recta 0→10 es grande.
    const out = simplifyStroke([p(0, 0), p(5, 10), p(10, 0)], DEFAULT_SIMPLIFY_EPSILON);
    expect(out).toEqual([p(0, 0), p(5, 10), p(10, 0)]);
  });

  it('siempre conserva el primer y el último punto', () => {
    const pts = Array.from({ length: 50 }, (_, i) => p(i, Math.sin(i) * 2 + 10));
    const out = simplifyStroke(pts);
    expect(out[0]).toEqual(pts[0]);
    expect(out.at(-1)).toEqual(pts.at(-1));
    expect(out.length).toBeLessThanOrEqual(pts.length);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('respeta el tope MAX_LINE_POINTS aun con epsilon=0 (decima)', () => {
    // 1000 puntos en zig-zag fino → epsilon 0 no colapsa nada; debe decimarse.
    const pts = Array.from({ length: 1000 }, (_, i) => p((i / 1000) * 100, i % 2 === 0 ? 10 : 11));
    const out = simplifyStroke(pts, 0, MAX_LINE_POINTS);
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_POINTS);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out.at(-1)).toEqual(pts.at(-1));
  });

  it('un tope explícito pequeño decima conservando extremos', () => {
    const pts = Array.from({ length: 100 }, (_, i) => p(i, i % 2 === 0 ? 0 : 5));
    const out = simplifyStroke(pts, 0, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out[0]).toEqual(pts[0]);
    expect(out.at(-1)).toEqual(pts.at(-1));
  });
});
