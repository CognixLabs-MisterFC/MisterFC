/**
 * F13.10 — Tokens de color por nota (escala 1–10), reutilizables por el editor,
 * la ficha y (luego) el PDF. Tonos suaves sobre tema oscuro:
 *   1–3 rojo · 4–6 ámbar · 7–9 verde · 10 verde más intenso · sin nota neutro.
 *
 * `scoreClasses` devuelve clases Tailwind (fondo/borde/texto) para chips y celdas;
 * `scoreHex` el color sólido para SVG/recharts (radar, líneas, mini-campo).
 */

export type ScoreLevel = 'none' | 'low' | 'mid' | 'high' | 'top';

/** Nivel de una nota (acepta medias: se redondea hacia el tramo por <,>=). */
export function scoreLevel(value: number | null | undefined): ScoreLevel {
  if (value == null || Number.isNaN(value)) return 'none';
  if (value >= 10) return 'top';
  if (value >= 7) return 'high';
  if (value >= 4) return 'mid';
  return 'low';
}

const CLASSES: Record<ScoreLevel, string> = {
  none: 'bg-muted text-muted-foreground border-border',
  low: 'bg-red-500/15 text-red-300 border-red-500/30',
  mid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  top: 'bg-emerald-500/30 text-emerald-200 border-emerald-400/50',
};

const HEX: Record<ScoreLevel, string> = {
  none: '#6b7280', // gray-500
  low: '#f87171', // red-400
  mid: '#fbbf24', // amber-400
  high: '#34d399', // emerald-400
  top: '#10b981', // emerald-500 (más intenso)
};

/** Clases Tailwind (bg+text+border) para una nota. */
export function scoreClasses(value: number | null | undefined): string {
  return CLASSES[scoreLevel(value)];
}

/** Color sólido (hex) para SVG/recharts. */
export function scoreHex(value: number | null | undefined): string {
  return HEX[scoreLevel(value)];
}

/**
 * F13.10e — Relleno para celdas de PDF (@react-pdf). El PDF va sobre fondo BLANCO,
 * así que aquí los tonos son claros (no los translúcidos del tema oscuro): fondo
 * suave + texto oscuro legible, mismo tramo de color (rojo/ámbar/verde/verde intenso).
 */
const PDF_FILL: Record<ScoreLevel, { bg: string; fg: string }> = {
  none: { bg: '#F1F5F9', fg: '#475569' }, // slate
  low: { bg: '#FEE2E2', fg: '#B91C1C' }, // red
  mid: { bg: '#FEF3C7', fg: '#B45309' }, // amber
  high: { bg: '#D1FAE5', fg: '#047857' }, // emerald
  top: { bg: '#A7F3D0', fg: '#065F46' }, // emerald (más intenso)
};

/** Fondo + texto (hex) para una nota en una celda de PDF (fondo claro). */
export function scorePdfFill(value: number | null | undefined): { bg: string; fg: string } {
  return PDF_FILL[scoreLevel(value)];
}

/** Formatea una nota/media: entero tal cual, media con 1 decimal, null → '—'. */
export function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
