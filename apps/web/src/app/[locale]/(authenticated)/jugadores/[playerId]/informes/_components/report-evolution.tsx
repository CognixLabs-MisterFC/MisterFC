'use client';

/**
 * F13.10f (adelantado) — Evolución multi-periodo: líneas de las 4 medias de grupo
 * del jugador a lo largo de los periodos (inicial→junio). Progresión INDIVIDUAL
 * (el jugador contra sí mismo); NO se compara con el equipo. Con 1 periodo con
 * datos se ve el punto; con ≥2, la línea. Huecos (null) no se interpolan. Se carga
 * con ssr:false (ADR-0016) desde report-charts.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export type EvolutionDatum = {
  period: string; // etiqueta del periodo (eje X)
  tecnico: number | null;
  tactico: number | null;
  fisico: number | null;
  actitud: number | null;
};

const SERIES: Array<{ key: keyof EvolutionDatum; color: string }> = [
  { key: 'tecnico', color: '#34d399' }, // emerald
  { key: 'tactico', color: '#60a5fa' }, // blue
  { key: 'fisico', color: '#fbbf24' }, // amber
  { key: 'actitud', color: '#c084fc' }, // purple
];

export function ReportEvolution({
  data,
  labels,
}: {
  data: EvolutionDatum[];
  labels: Record<string, string>;
}) {
  return (
    <div className="h-64 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 10]} ticks={[2, 4, 6, 8, 10]} allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value, name) => [
              value ?? '—',
              labels[String(name)] ?? String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) => labels[String(value)] ?? String(value)}
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.key}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
