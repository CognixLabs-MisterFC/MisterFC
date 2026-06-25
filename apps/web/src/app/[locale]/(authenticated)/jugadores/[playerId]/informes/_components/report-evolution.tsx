'use client';

/**
 * F13.10f / F13.10h-3 — Evolución multi-periodo: líneas de las medias de grupo a
 * lo largo de los periodos (inicial→junio). Progresión contra UNO MISMO (jugador
 * o equipo); NO compara entre sujetos. Con 1 periodo con datos se ve el punto; con
 * ≥2, la línea. Huecos (null) no se interpolan. Se carga con ssr:false (ADR-0016).
 *
 * H-3: parametrizado por `series` (clave de grupo + color) para reusarlo tanto con
 * los 4 grupos del catálogo individual como con los 3 del de equipo. Los datos son
 * filas planas `{ period, [groupId]: media|null }`.
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

/** Fila plana: etiqueta de periodo (eje X) + una media por grupo. */
export type EvolutionDatum = { period: string } & Record<string, number | string | null>;

/** Serie de una línea: clave del grupo en los datos + color del trazo. */
export type EvolutionSeries = { key: string; color: string };

export function ReportEvolution({
  data,
  series,
  labels,
}: {
  data: EvolutionDatum[];
  series: EvolutionSeries[];
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
          {series.map((s) => (
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
