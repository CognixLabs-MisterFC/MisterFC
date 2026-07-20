'use client';

import { useTranslations } from 'next-intl';
import { normalizeDate, type ValidatedRow } from '@misterfc/core';

export type EditableField = 'full_name' | 'date_of_birth' | 'team' | 'email';

type Team = { id: string; name: string; category_name: string };

type Props = {
  rows: ValidatedRow[];
  /** Fuente editable (keys canónicas) paralela a `rows` por índice. */
  rawRows: Array<Record<string, unknown>>;
  teams: Team[];
  onEdit: (index: number, field: EditableField, value: string) => void;
};

/** Normaliza un nombre de equipo para comparar (sin acentos, lowercase, trim). */
function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Tabla EDITABLE (rework 2026-07). Cada fila muestra las 4 columnas de la
 * plantilla como campos editables; al cambiar cualquiera, el padre revalida esa
 * fila con el MISMO validador del import (validateRow + resolución de equipo +
 * dedup) y actualiza el estado (verde/ámbar/rojo) en vivo. Solo las filas en
 * estado `valid` se importan al confirmar.
 *
 * Se limita a las primeras 200 filas en pantalla — para >200, la cabecera
 * aclara que el resto se procesa pero no se renderiza (y por tanto no es
 * editable aquí; ver nota de la verificación).
 */
export function PreviewTable({ rows, rawRows, teams, onEdit }: Props) {
  const t = useTranslations('import');
  const visible = rows.slice(0, 200);
  const truncated = rows.length > 200;

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
          <tr>
            <th className="px-3 py-2">#</th>
            <th
              className="px-3 py-2 text-emerald-300"
              title={t('col.required_hint')}
            >
              {t('col.first_name')} *
            </th>
            <th
              className="px-3 py-2 text-emerald-300"
              title={t('col.required_hint')}
            >
              {t('col.date_of_birth')} *
            </th>
            <th className="px-3 py-2">{t('col.team')}</th>
            <th
              className="px-3 py-2 text-emerald-300"
              title={t('col.required_hint')}
            >
              {t('col.email')} *
            </th>
            <th className="px-3 py-2">{t('col.status')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <RowItem
              key={row.index}
              row={row}
              raw={rawRows[row.index] ?? {}}
              teams={teams}
              onEdit={onEdit}
            />
          ))}
        </tbody>
      </table>
      {truncated && (
        <p className="border-t border-zinc-800 px-3 py-2 text-xs text-muted-foreground">
          {t('preview.truncated', { count: rows.length - 200 })}
        </p>
      )}
    </div>
  );
}

function RowItem({
  row,
  raw,
  teams,
  onEdit,
}: {
  row: ValidatedRow;
  raw: Record<string, unknown>;
  teams: Team[];
  onEdit: (index: number, field: EditableField, value: string) => void;
}) {
  const t = useTranslations('import');
  const colorClass =
    row.status === 'valid'
      ? 'bg-emerald-950/40'
      : row.status === 'duplicate'
        ? 'bg-amber-950/40'
        : 'bg-red-950/40';
  const reason = row.reason ? t(`reason.${row.reason}`) : '';

  const nameValue = str(raw.first_name);
  const emailValue = str(raw.invite_email);
  // input type=date exige yyyy-mm-dd: normalizamos el valor crudo (que puede
  // venir dd/mm/yyyy del archivo) para que se muestre.
  const dateValue = normalizeDate(raw.date_of_birth) ?? '';

  // Equipo: <select> con los equipos de la temporada activa + opción vacía.
  // Si el valor crudo no casa con ningún equipo (p.ej. "team_not_found"), se
  // añade una opción extra para no perder de vista lo que trae el archivo.
  const teamRaw = str(raw.team);
  const matched = teamRaw
    ? teams.find((tm) => foldName(tm.name) === foldName(teamRaw))
    : undefined;
  const teamSelectValue = matched ? matched.name : teamRaw;

  const inputCls =
    'w-full min-w-28 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100';

  return (
    <tr className={`border-t border-zinc-800 ${colorClass}`}>
      <td className="px-3 py-2 align-top text-xs text-zinc-500">{row.index + 1}</td>
      <td className="px-3 py-2 align-top">
        <input
          type="text"
          className={inputCls}
          value={nameValue}
          aria-label={t('col.first_name')}
          onChange={(e) => onEdit(row.index, 'full_name', e.target.value)}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="date"
          className={inputCls}
          value={dateValue}
          aria-label={t('col.date_of_birth')}
          onChange={(e) => onEdit(row.index, 'date_of_birth', e.target.value)}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <select
          className={inputCls}
          value={teamSelectValue}
          aria-label={t('col.team')}
          onChange={(e) => onEdit(row.index, 'team', e.target.value)}
        >
          <option value="">{t('col.team_none')}</option>
          {teamRaw && !matched && (
            <option value={teamRaw}>{teamRaw} (?)</option>
          )}
          {teams.map((tm) => (
            <option key={tm.id} value={tm.name}>
              {tm.category_name} · {tm.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="text"
          className={inputCls}
          value={emailValue}
          aria-label={t('col.email')}
          onChange={(e) => onEdit(row.index, 'email', e.target.value)}
        />
      </td>
      <td className="px-3 py-2 align-top text-xs">
        <span
          className={`font-medium ${
            row.status === 'valid'
              ? 'text-emerald-200'
              : row.status === 'duplicate'
                ? 'text-amber-200'
                : 'text-red-200'
          }`}
        >
          {t(`status.${row.status}`)}
        </span>
        {reason && <span className="ml-1 text-zinc-400">— {reason}</span>}
      </td>
    </tr>
  );
}
