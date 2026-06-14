'use client';

import dynamic from 'next/dynamic';
import type { TrendPoint } from './attendance-trend-chart';

/**
 * F10.4 — Frontera cliente para el gráfico de tendencia. Carga recharts (+d3)
 * solo en cliente vía `dynamic(ssr:false)` (mismo patrón que 9.B-2): mantiene la
 * librería fuera del bundle de servidor. La page (server component) renderiza
 * este wrapper pasándole los puntos ya calculados en core.
 */
const AttendanceTrendChart = dynamic(
  () => import('./attendance-trend-chart').then((m) => m.AttendanceTrendChart),
  { ssr: false },
);

export function AttendanceTrend({ points }: { points: TrendPoint[] }) {
  return <AttendanceTrendChart points={points} />;
}
