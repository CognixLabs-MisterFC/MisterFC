/**
 * F13.10h-PDF-2 — Gráficos del informe en SVG NATIVO de @react-pdf (sin recharts):
 *  · RadarPdf: radar de las medias de grupo (polar→cartesiano, anillos + ejes +
 *    polígono de valores).
 *  · EvolutionLinesPdf: líneas de evolución por grupo a lo largo de los periodos,
 *    con manejo de HUECOS (periodos null → la línea se parte, connectNulls=false,
 *    como en la ficha). Reusa smoothPathD (core) por cada tramo continuo.
 *
 * Escala 0..10. Lógica de presentación pura: recibe medias ya calculadas.
 */

import { View, Text, Svg, G, Line, Polygon, Path, Circle } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { smoothPathD, type PathPoint } from '@misterfc/core';

const AXIS = '#CBD5E1';
const GRID = '#E2E8F0';
const LABEL = '#475569';
const VALUE_FILL = '#10B981';

// ── Radar ────────────────────────────────────────────────────────────────────
const R_SIZE = 188;
const R_CX = R_SIZE / 2;
const R_CY = R_SIZE / 2;
const R_MAX = 60;
const R_RINGS = [2.5, 5, 7.5, 10] as const;

function radarPoint(value: number, index: number, n: number): PathPoint {
  const ang = ((-90 + (index * 360) / n) * Math.PI) / 180;
  const r = (Math.max(0, Math.min(10, value)) / 10) * R_MAX;
  return { x: R_CX + r * Math.cos(ang), y: R_CY + r * Math.sin(ang) };
}

function ringPoints(level: number, n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const p = radarPoint(level, i, n);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
}

/** Radar de N ejes (una media por eje, 0..10). */
export function RadarPdf({
  axes,
}: {
  axes: Array<{ label: string; value: number | null }>;
}): ReactElement {
  const n = axes.length;
  const valuePts = axes.map((a, i) => radarPoint(a.value ?? 0, i, n));
  const valueStr = valuePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={R_SIZE} height={R_SIZE}>
        {/* Anillos de fondo */}
        {R_RINGS.map((lvl) => (
          <Polygon
            key={lvl}
            points={ringPoints(lvl, n)}
            fill="none"
            stroke={lvl === 10 ? AXIS : GRID}
            strokeWidth={lvl === 10 ? 1 : 0.5}
          />
        ))}
        {/* Ejes */}
        <G>
          {axes.map((_, i) => {
            const tip = radarPoint(10, i, n);
            return (
              <Line key={i} x1={R_CX} y1={R_CY} x2={tip.x} y2={tip.y} stroke={GRID} strokeWidth={0.5} />
            );
          })}
        </G>
        {/* Polígono de valores */}
        <Polygon points={valueStr} fill={VALUE_FILL} fillOpacity={0.18} stroke={VALUE_FILL} strokeWidth={1.5} />
        {valuePts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={2} fill={VALUE_FILL} />
        ))}
        {/* Etiquetas de eje */}
        {axes.map((a, i) => {
          const tip = radarPoint(11.6, i, n);
          const anchor = tip.x < R_CX - 4 ? 'end' : tip.x > R_CX + 4 ? 'start' : 'middle';
          return (
            <Text
              key={i}
              x={tip.x}
              y={tip.y + 2}
              style={{ fontSize: 7, fill: LABEL }}
              textAnchor={anchor}
            >
              {a.label}
            </Text>
          );
        })}
      </Svg>
    </View>
  );
}

// ── Líneas de evolución ───────────────────────────────────────────────────────
const L_W = 515;
const L_H = 168;
const L_PADL = 24;
const L_PADR = 8;
const L_PADT = 10;
const L_PADB = 20;

export type EvolutionSeriesDef = { key: string; color: string; label: string };

/** Gráfico de líneas (0..10) de varias series sobre los periodos, con huecos. */
export function EvolutionLinesPdf({
  rows,
  periods,
  periodLabel,
  series,
}: {
  /** Filas por periodo; cada una con `period` + una media numérica por grupo. */
  rows: ReadonlyArray<{ period: string }>;
  periods: readonly string[];
  periodLabel: (p: string) => string;
  series: EvolutionSeriesDef[];
}): ReactElement {
  const plotL = L_PADL;
  const plotR = L_W - L_PADR;
  const plotT = L_PADT;
  const plotB = L_H - L_PADB;
  const nP = periods.length;

  const xAt = (i: number) => (nP <= 1 ? (plotL + plotR) / 2 : plotL + (i / (nP - 1)) * (plotR - plotL));
  const yAt = (v: number) => plotB - (Math.max(0, Math.min(10, v)) / 10) * (plotB - plotT);

  const byPeriod = new Map(
    rows.map((r) => [r.period, r as Record<string, number | string | null>]),
  );
  const valueAt = (key: string, p: string): number | null => {
    const v = byPeriod.get(p)?.[key];
    return typeof v === 'number' ? v : null;
  };

  // Para una serie: tramos continuos (sin null) → un path suavizado por tramo.
  const runsFor = (key: string): PathPoint[][] => {
    const runs: PathPoint[][] = [];
    let cur: PathPoint[] = [];
    periods.forEach((p, i) => {
      const v = valueAt(key, p);
      if (v == null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else {
        cur.push({ x: xAt(i), y: yAt(v) });
      }
    });
    if (cur.length) runs.push(cur);
    return runs;
  };

  return (
    <View>
      <Svg width={L_W} height={L_H}>
        {/* Rejilla horizontal + etiquetas Y (0,2,…,10) */}
        {[0, 2, 4, 6, 8, 10].map((v) => {
          const y = yAt(v);
          return (
            <G key={v}>
              <Line x1={plotL} y1={y} x2={plotR} y2={y} stroke={GRID} strokeWidth={0.5} />
              <Text x={plotL - 4} y={y + 2} style={{ fontSize: 6, fill: LABEL }} textAnchor="end">
                {String(v)}
              </Text>
            </G>
          );
        })}
        {/* Etiquetas de periodo (eje X) */}
        {periods.map((p, i) => (
          <Text
            key={p}
            x={xAt(i)}
            y={plotB + 12}
            style={{ fontSize: 6.5, fill: LABEL }}
            textAnchor="middle"
          >
            {periodLabel(p)}
          </Text>
        ))}
        {/* Series */}
        {series.map((sdef) => {
          const runs = runsFor(sdef.key);
          return (
            <G key={sdef.key}>
              {runs.map((run, ri) => (
                <Path
                  key={ri}
                  d={smoothPathD(run)}
                  fill="none"
                  stroke={sdef.color}
                  strokeWidth={1.5}
                />
              ))}
              {runs.flat().map((pt, pi) => (
                <Circle key={pi} cx={pt.x} cy={pt.y} r={1.8} fill={sdef.color} />
              ))}
            </G>
          );
        })}
      </Svg>
      {/* Leyenda */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
        {series.map((sdef) => (
          <View key={sdef.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 3, backgroundColor: sdef.color, borderRadius: 1 }} />
            <Text style={{ fontSize: 7, color: LABEL }}>{sdef.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
