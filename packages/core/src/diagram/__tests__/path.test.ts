import { describe, it, expect } from 'vitest';
import { smoothPathD, type PathPoint } from '../path';

const p = (x: number, y: number): PathPoint => ({ x, y });

describe('smoothPathD', () => {
  it('vacío → cadena vacía', () => {
    expect(smoothPathD([])).toBe('');
  });

  it('1 punto → solo Move', () => {
    expect(smoothPathD([p(10, 20)])).toBe('M 10 20');
  });

  it('2 puntos → RECTA (preserva la línea recta, sin curvas)', () => {
    const d = smoothPathD([p(0, 0), p(50, 80)]);
    expect(d).toBe('M 0 0 L 50 80');
    expect(d).not.toContain('Q');
    expect(d).not.toContain('C');
  });

  it('≥3 puntos → usa curvas cuadráticas (Q), no segmentos rectos intermedios', () => {
    const d = smoothPathD([p(0, 0), p(10, 10), p(20, 0)]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q');
  });

  it('pasa por el primer y el último punto', () => {
    const pts = [p(2, 3), p(5, 9), p(11, 4), p(17, 7)];
    const d = smoothPathD(pts);
    expect(d.startsWith('M 2 3')).toBe(true);
    expect(d.endsWith('L 17 7')).toBe(true);
  });

  it('control = punto interior, extremo del tramo = punto medio con el siguiente', () => {
    // 3 puntos: el único tramo curvo usa p1 como control y mid(p1,p2) como fin.
    const d = smoothPathD([p(0, 0), p(10, 10), p(20, 30)]);
    // mid(p1,p2) = (15, 20)
    expect(d).toBe('M 0 0 Q 10 10 15 20 L 20 30');
  });

  it('redondea a 2 decimales y normaliza -0 → 0', () => {
    const d = smoothPathD([p(-0, 1.006), p(2.001, 3.4567)]);
    // 1.006 → 1.01 (redondeo), 2.001 → 2, 3.4567 → 3.46, -0 → 0
    expect(d).toBe('M 0 1.01 L 2 3.46');
  });

  it('es determinista (misma entrada → misma salida)', () => {
    const pts = [p(1, 1), p(2, 5), p(8, 2), p(9, 9), p(3, 7)];
    expect(smoothPathD(pts)).toBe(smoothPathD(pts));
  });

  it('nº de tramos Q = nº de puntos − 2 (un control por punto interior)', () => {
    const pts = [p(0, 0), p(1, 2), p(2, 0), p(3, 2), p(4, 0)]; // 5 puntos
    const d = smoothPathD(pts);
    const qCount = (d.match(/Q/g) ?? []).length;
    expect(qCount).toBe(pts.length - 2); // 3
  });
});
