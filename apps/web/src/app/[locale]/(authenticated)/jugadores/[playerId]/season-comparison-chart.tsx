'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { seasonComparison, type SeasonMetric } from '@misterfc/core';
import type { CareerSeason } from '@/lib/player-career';

/**
 * F9.4 / 9.B-2 — Comparación de una métrica elegible ENTRE temporadas (carrera).
 * Reusa `seasonComparison` (core, puro) por cada cambio de métrica. Patrón de
 * 9.3: recharts cargado vía dynamic(ssr:false) desde el padre + tabla `sr-only`
 * equivalente (lectores de pantalla + futuro PDF). El % titularidad (`startRate`)
 * se pinta como porcentaje; las demás como número.
 */

const COLOR = '#10b981'; // misterfc green

// Métricas ofrecidas en el selector, en orden de relevancia.
const METRICS: ReadonlyArray<{ key: SeasonMetric; pct?: boolean }> = [
  { key: 'goals' },
  { key: 'assists' },
  { key: 'minutesPlayed' },
  { key: 'matches' },
  { key: 'startRate', pct: true },
  { key: 'goalsPer90' },
  { key: 'rating' },
];

export function SeasonComparisonChart({
  bySeason,
}: {
  bySeason: CareerSeason[];
}) {
  const t = useTranslations('jugadores.stats.career');
  const [metric, setMetric] = useState<SeasonMetric>('goals');

  const isPct = METRICS.find((m) => m.key === metric)?.pct ?? false;

  // Orden ascendente para el eje X (cronológico izq→der); el helper conserva el
  // orden de entrada, así que invertimos la entrada (que viene desc).
  const series = useMemo(() => {
    const asc = [...bySeason].sort((a, b) => a.season.localeCompare(b.season));
    return seasonComparison(asc, metric).map((p) => ({
      season: p.season,
      value: p.value,
      display:
        p.value == null
          ? '—'
          : isPct
            ? `${Math.round(p.value * 100)}%`
            : Number.isInteger(p.value)
              ? p.value.toString()
              : p.value.toFixed(2),
      // recharts no pinta null: usamos 0 para la barra pero el tooltip/tabla
      // muestran "—" cuando el valor real es null.
      barValue: p.value == null ? 0 : isPct ? p.value * 100 : p.value,
    }));
  }, [bySeason, metric, isPct]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label
          htmlFor="metric-select"
          className="text-sm text-muted-foreground"
        >
          {t('metric_label')}
        </label>
        <select
          id="metric-select"
          value={metric}
          onChange={(e) => setMetric(e.target.value as SeasonMetric)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {t(`metric.${m.key}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={series}
            margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="season" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={!isPct} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0]?.payload as (typeof series)[number];
                return (
                  <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
                    <p className="font-medium">{d.season}</p>
                    <p>
                      {t(`metric.${metric}`)}:{' '}
                      <span className="font-semibold">{d.display}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="barValue" fill={COLOR} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla equivalente (lectores de pantalla + futuro PDF). */}
      <table className="sr-only">
        <caption>{t('comparison_caption')}</caption>
        <thead>
          <tr>
            <th>{t('table.season')}</th>
            <th>{t(`metric.${metric}`)}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.season}>
              <td>{d.season}</td>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
