'use client';

import { useTranslations } from 'next-intl';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

/**
 * F10.4 — Gráfico de TENDENCIA de asistencia por semana (line chart). Patrón de
 * 9.3/9.B-2: recharts cargado vía `dynamic(ssr:false)` desde el wrapper cliente
 * (`attendance-trend.tsx`) + tabla `sr-only` equivalente (lectores de pantalla).
 * Los datos (% presencia por semana ISO) los calcula `clubAttendanceAgg` en core;
 * aquí solo se pintan.
 */

const COLOR = '#10b981'; // misterfc green

export type TrendPoint = {
  /** Etiqueta del eje X (clave de semana ISO `YYYY-Www`). */
  label: string;
  /** % presencia 0..100. */
  pct: number;
  present: number;
  total: number;
};

export function AttendanceTrendChart({ points }: { points: TrendPoint[] }) {
  const t = useTranslations('dashboard.attendance');

  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0]?.payload as TrendPoint;
                return (
                  <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
                    <p className="font-medium">{d.label}</p>
                    <p>
                      {t('trend.pct')}: <span className="font-semibold">{Math.round(d.pct)}%</span>
                    </p>
                    <p className="text-muted-foreground">
                      {t('trend.sample', { present: d.present, total: d.total })}
                    </p>
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="pct" stroke={COLOR} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla equivalente (lectores de pantalla). */}
      <table className="sr-only">
        <caption>{t('trend.caption')}</caption>
        <thead>
          <tr>
            <th>{t('trend.col_week')}</th>
            <th>{t('trend.pct')}</th>
            <th>{t('trend.col_sample')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{Math.round(d.pct)}%</td>
              <td>
                {d.present}/{d.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
