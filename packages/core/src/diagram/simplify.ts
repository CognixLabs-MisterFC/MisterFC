/**
 * F11B.0 — Simplificación de un trazo a mano alzada (dibujo libre).
 *
 * El dibujo libre se captura muestreando el puntero → muchos puntos. Antes de
 * confirmarlo como un `linea` del contrato hay que (a) reducir el ruido/peso del
 * trazo preservando su forma y (b) garantizar que NO supera `MAX_LINE_POINTS`
 * (límite del contrato). Lógica PURA (sin DOM): se testea con Vitest.
 *
 * Enfoque: Ramer–Douglas–Peucker (RDP) con una tolerancia `epsilon` en unidades
 * de % del campo. Si tras RDP aún quedan más puntos que el tope, se decima de
 * forma uniforme conservando SIEMPRE el primer y el último punto.
 */

import { MAX_LINE_POINTS, type DiagramPoint } from './diagram';

/** Tolerancia RDP por defecto, en % del campo. Suaviza el temblor del trazo
 *  sin deformar la curva (mayor = menos puntos). */
export const DEFAULT_SIMPLIFY_EPSILON = 0.6;

/** Distancia perpendicular de `p` al segmento `a`–`b` (en % del campo). */
function perpendicularDistance(p: DiagramPoint, a: DiagramPoint, b: DiagramPoint): number {
  const dx = b.x_pct - a.x_pct;
  const dy = b.y_pct - a.y_pct;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // a y b coinciden → distancia euclídea a ese punto.
    return Math.hypot(p.x_pct - a.x_pct, p.y_pct - a.y_pct);
  }
  // Proyección escalar de ap sobre ab, acotada al segmento [0,1].
  const t = ((p.x_pct - a.x_pct) * dx + (p.y_pct - a.y_pct) * dy) / lenSq;
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  const projX = a.x_pct + tc * dx;
  const projY = a.y_pct + tc * dy;
  return Math.hypot(p.x_pct - projX, p.y_pct - projY);
}

/** RDP recursivo sobre `points[first..last]` (ambos inclusive). Devuelve los
 *  índices a conservar, en orden ascendente. */
function rdpIndices(points: DiagramPoint[], first: number, last: number, epsilon: number): number[] {
  const a = points[first];
  const b = points[last];
  if (!a || !b || last <= first + 1) return [first, last];

  let maxDist = -1;
  let idx = -1;
  for (let i = first + 1; i < last; i++) {
    const p = points[i];
    if (!p) continue;
    const d = perpendicularDistance(p, a, b);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }

  if (maxDist > epsilon && idx !== -1) {
    const left = rdpIndices(points, first, idx, epsilon);
    const right = rdpIndices(points, idx, last, epsilon);
    // `idx` aparece en ambos lados → se quita el duplicado del empalme.
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Decima `points` a lo sumo `max` elementos, conservando el primero y el
 *  último y repartiendo el resto de forma uniforme. */
function decimate(points: DiagramPoint[], max: number): DiagramPoint[] {
  if (points.length <= max) return points.slice();
  if (max <= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last ? [first, last] : points.slice(0, max);
  }
  const out: DiagramPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = points[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}

/**
 * Simplifica un trazo a mano alzada: RDP con `epsilon` + tope `max` puntos
 * (≤ `MAX_LINE_POINTS`). Conserva siempre los extremos y nunca devuelve menos de
 * 2 puntos si la entrada tenía ≥2 (requisito de `linea` del contrato).
 */
export function simplifyStroke(
  points: DiagramPoint[],
  epsilon: number = DEFAULT_SIMPLIFY_EPSILON,
  max: number = MAX_LINE_POINTS,
): DiagramPoint[] {
  if (points.length <= 2) return points.slice();

  const keep = rdpIndices(points, 0, points.length - 1, epsilon);
  let simplified = keep.map((i) => points[i]).filter((p): p is DiagramPoint => p != null);

  if (simplified.length > max) simplified = decimate(simplified, max);

  if (simplified.length < 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last) return [first, last];
  }
  return simplified;
}
