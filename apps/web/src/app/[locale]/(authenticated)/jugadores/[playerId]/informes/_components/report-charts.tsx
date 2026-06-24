'use client';

/**
 * F13.10 — Envoltorios de carga diferida (ssr:false, ADR-0016) de los gráficos del
 * informe (radar + evolución). Mantiene recharts/d3 fuera del bundle de servidor y
 * del SSR; la página (server component) importa estos wrappers y pasa los datos.
 */

import dynamic from 'next/dynamic';

export const GroupRadarChart = dynamic(
  () => import('./report-radar').then((m) => m.ReportRadar),
  { ssr: false },
);

export const EvolutionChart = dynamic(
  () => import('./report-evolution').then((m) => m.ReportEvolution),
  { ssr: false },
);
