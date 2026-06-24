'use client';

/**
 * F13.10 — Radar (araña) de las 4 medias de grupo del informe individual, para el
 * vistazo. Recibe los datos ya calculados (label + valor 0–10). Se carga con
 * ssr:false (ADR-0016) desde report-charts.
 */

import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

export type RadarDatum = { group: string; value: number };

export function ReportRadar({ data }: { data: RadarDatum[] }) {
  return (
    <div className="h-64 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid className="stroke-border" />
          <PolarAngleAxis dataKey="group" tick={{ fontSize: 12, fill: 'currentColor' }} />
          <PolarRadiusAxis domain={[0, 10]} tickCount={6} tick={{ fontSize: 10 }} />
          <Radar
            dataKey="value"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.35}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
