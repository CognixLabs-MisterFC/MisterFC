/**
 * F11B — Generador COMPARTIDO del `d` (path SVG) de una polilínea de puntos.
 *
 * El trazo a mano alzada (dibujo libre) y la línea recta se guardan ambos como
 * `type: 'linea'` con `points[]` (mismo contrato). Para que el dibujo libre NO
 * parezca un polígono (octógono), el path se genera con CURVAS cuadráticas por
 * PUNTOS MEDIOS en lugar de segmentos rectos. Los puntos guardados NO cambian:
 * el suavizado es solo de RENDER.
 *
 * Clave para no afectar a la línea recta: con 2 puntos se emite una RECTA (`L`);
 * solo con ≥3 puntos (propio del dibujo libre) se curva. Así la herramienta de
 * línea (siempre 2 puntos) se ve idéntica.
 *
 * Trabaja en coordenadas NUMÉRICAS genéricas (`{x, y}`) ya mapeadas al espacio
 * de destino, así sirve por igual al editor (preview en 0..100), a `DiagramView`
 * (read-only, espacio del viewBox) y al PDF (@react-pdf, que soporta Q/C en el
 * `d` de `<Path>`). Lógica PURA (sin DOM): testeable con Vitest.
 */

export type PathPoint = { x: number; y: number };

/** Redondea a 2 decimales (compacta el `d` y lo hace determinista) y normaliza
 *  el `-0` a `0` para una salida estable. */
function r(n: number): number {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
}

/**
 * Devuelve el `d` de un `<path>` que recorre `points`:
 *  - `[]`        → `''` (nada que pintar).
 *  - 1 punto     → `M x y` (degenerado; un solo punto).
 *  - 2 puntos    → `M x0 y0 L x1 y1` (RECTA — preserva la línea recta).
 *  - ≥3 puntos   → curvas cuadráticas por puntos medios: cada punto interior es
 *    el control y el punto medio con el siguiente es el extremo del tramo; se
 *    cierra con una recta corta al último punto. Pasa por el primer y el último
 *    punto y suaviza el resto.
 */
export function smoothPathD(points: PathPoint[]): string {
  const n = points.length;
  if (n === 0) return '';

  const p0 = points[0];
  if (!p0) return '';
  if (n === 1) return `M ${r(p0.x)} ${r(p0.y)}`;

  if (n === 2) {
    const p1 = points[1];
    if (!p1) return `M ${r(p0.x)} ${r(p0.y)}`;
    return `M ${r(p0.x)} ${r(p0.y)} L ${r(p1.x)} ${r(p1.y)}`;
  }

  let d = `M ${r(p0.x)} ${r(p0.y)}`;
  for (let i = 1; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    d += ` Q ${r(a.x)} ${r(a.y)} ${r(mx)} ${r(my)}`;
  }
  const last = points[n - 1];
  if (last) d += ` L ${r(last.x)} ${r(last.y)}`;
  return d;
}
