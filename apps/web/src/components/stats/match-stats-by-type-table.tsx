/**
 * F9B-3 — Tabla de estadísticas de partido desglosadas por TIPO de evento,
 * compartida por el informe de desarrollo (6 métricas) y la pestaña de
 * estadísticas del perfil (12 métricas).
 *
 * Presentacional PURO (sin hooks, sin i18n): recibe las etiquetas ya traducidas y
 * las celdas ya formateadas como string, para poder usarse tanto en Server
 * Components (informe) como en Client Components (perfil) sin acoplarse a un
 * namespace de traducción ni a un shape de datos concreto (FichaMatchLine vs
 * AggregatedStats — cada caller formatea sus métricas).
 *
 * Orden de columnas (decisión de producto, idéntico en informe y perfil):
 * Amistoso · Torneo · Oficial · Total. Jerarquía visual: Amistoso/Torneo pequeños
 * y tenues; Oficial grande y en negrita (número protagonista); Total grande sin
 * negrita. Soporta N filas (métricas) preservando el orden del array.
 */

import { Fragment } from 'react';

/** Las 4 cifras de una métrica, ya formateadas (p.ej. "3", "75%", "—"). */
export type MatchTypeCells = {
  amistoso: string;
  torneo: string;
  oficial: string;
  total: string;
};

/** Una fila = una métrica con su etiqueta traducida y sus 4 cifras. */
export type MatchStatsByTypeRow = {
  key: string;
  label: string;
  cells: MatchTypeCells;
};

/** Etiquetas de las 4 columnas (ya traducidas). */
export type MatchStatsByTypeColumns = {
  friendly: string;
  tournament: string;
  official: string;
  total: string;
};

export function MatchStatsByTypeTable({
  columns,
  rows,
}: {
  columns: MatchStatsByTypeColumns;
  rows: MatchStatsByTypeRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[22rem] grid-cols-[minmax(5rem,1.4fr)_repeat(4,minmax(0,1fr))] items-center gap-x-2">
        {/* Cabecera de columnas (la celda de la esquina va vacía). */}
        <span aria-hidden />
        <span className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
          {columns.friendly}
        </span>
        <span className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
          {columns.tournament}
        </span>
        <span className="pb-1 text-center text-xs font-semibold text-foreground">
          {columns.official}
        </span>
        <span className="pb-1 text-center text-xs font-medium text-muted-foreground">
          {columns.total}
        </span>

        {/* Filas por métrica: Amistoso/Torneo tenues; Oficial destacada; Total al lado. */}
        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className="border-t border-border/60 py-1.5 text-xs text-muted-foreground">
              {r.label}
            </span>
            <span className="border-t border-border/60 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
              {r.cells.amistoso}
            </span>
            <span className="border-t border-border/60 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
              {r.cells.torneo}
            </span>
            <span className="border-t border-border/60 py-1.5 text-center text-base font-bold tabular-nums">
              {r.cells.oficial}
            </span>
            <span className="border-t border-border/60 py-1.5 text-center text-base tabular-nums">
              {r.cells.total}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
