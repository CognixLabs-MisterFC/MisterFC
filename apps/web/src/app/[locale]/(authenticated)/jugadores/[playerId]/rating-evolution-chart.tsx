'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
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
import type { RatingTimelinePoint } from '@misterfc/core';

/**
 * F9.3 — Gráfico de evolución intra-temporada de la valoración (REUTILIZABLE).
 * Vista staff (9.3) lo muestra siempre; la vista jugador/familia (9.5) lo usará
 * solo con el flag ON. Solo presenta: recibe los puntos ya ordenados (server +
 * `ratingTimeline`). Línea principal = nota individual; línea de contexto = nota
 * colectiva del equipo. Los `null` quedan como HUECO (no se interpola).
 *
 * Accesible: además del SVG hay una tabla equivalente `sr-only` (lectores de
 * pantalla + base para el reporte PDF del segundo tramo).
 */

const COLOR_INDIVIDUAL = '#10b981'; // misterfc green
const COLOR_TEAM = '#64748b'; // slate-500

type ChartDatum = {
  x: string; // etiqueta corta de eje (fecha dd/MM)
  label: string; // rival / título (tooltip)
  date: string; // fecha legible (tooltip)
  rating: number | null;
  teamRating: number | null;
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function RatingEvolutionChart({
  points,
}: {
  points: RatingTimelinePoint[];
}) {
  const t = useTranslations('jugadores.stats.evolution');

  const data = useMemo<ChartDatum[]>(
    () =>
      points.map((p) => ({
        x: shortDate(p.startsAt),
        label: p.label,
        date: shortDate(p.startsAt),
        rating: p.rating,
        teamRating: p.teamRating,
      })),
    [points]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[1, 10]}
              ticks={[2, 4, 6, 8, 10]}
              allowDecimals={false}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0]?.payload as ChartDatum;
                return (
                  <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
                    <p className="font-medium">{d.label}</p>
                    <p className="text-muted-foreground">{d.date}</p>
                    <p>
                      {t('individual')}:{' '}
                      <span className="font-semibold">{d.rating ?? '—'}</span>
                    </p>
                    {d.teamRating != null && (
                      <p>
                        {t('collective')}:{' '}
                        <span className="font-semibold">{d.teamRating}</span>
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="rating"
              name={t('individual')}
              stroke={COLOR_INDIVIDUAL}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="teamRating"
              name={t('collective')}
              stroke={COLOR_TEAM}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 2 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla equivalente (lectores de pantalla + futuro PDF). */}
      <table className="sr-only">
        <caption>{t('table_caption')}</caption>
        <thead>
          <tr>
            <th>{t('col_date')}</th>
            <th>{t('col_match')}</th>
            <th>{t('individual')}</th>
            <th>{t('collective')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${d.x}-${i}`}>
              <td>{d.date}</td>
              <td>{d.label}</td>
              <td>{d.rating ?? '—'}</td>
              <td>{d.teamRating ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
