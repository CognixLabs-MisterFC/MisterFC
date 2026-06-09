'use client';

import { useTranslations } from 'next-intl';
import type { ValidatedRow } from '@misterfc/core';

type Props = {
  rows: ValidatedRow[];
};

/**
 * Tabla coloreada (verde/amarillo/rojo) que la spec exige en el paso 2.
 * Se limita a las primeras 200 filas en pantalla — para >200, la cabecera
 * aclara que el resto se importa pero no se renderiza para no saturar el DOM.
 */
export function PreviewTable({ rows }: Props) {
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
            <th className="px-3 py-2">{t('col.last_name')}</th>
            <th
              className="px-3 py-2 text-emerald-300"
              title={t('col.required_hint')}
            >
              {t('col.date_of_birth')} *
            </th>
            <th className="px-3 py-2">{t('col.dorsal')}</th>
            <th className="px-3 py-2">{t('col.position_main')}</th>
            <th className="px-3 py-2">{t('col.team')}</th>
            <th className="px-3 py-2">{t('col.email')}</th>
            <th className="px-3 py-2">{t('col.status')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <RowItem key={row.index} row={row} />
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

function RowItem({ row }: { row: ValidatedRow }) {
  const t = useTranslations('import');
  const colorClass =
    row.status === 'valid'
      ? 'bg-emerald-950/40 text-emerald-200'
      : row.status === 'duplicate'
        ? 'bg-amber-950/40 text-amber-200'
        : 'bg-red-950/40 text-red-200';
  const reason = row.reason ? t(`reason.${row.reason}`) : '';
  return (
    <tr className={`border-t border-zinc-800 ${colorClass}`}>
      <td className="px-3 py-2 align-top text-xs text-zinc-500">{row.index + 1}</td>
      <td className="px-3 py-2 align-top">{row.data?.first_name ?? ''}</td>
      <td className="px-3 py-2 align-top text-muted-foreground">
        {row.data?.last_name ?? ''}
      </td>
      <td className="px-3 py-2 align-top">{row.data?.date_of_birth ?? ''}</td>
      <td className="px-3 py-2 align-top">{row.data?.dorsal ?? ''}</td>
      <td className="px-3 py-2 align-top">{row.data?.position_main ?? ''}</td>
      <td className="px-3 py-2 align-top">{row.data?.team ?? ''}</td>
      <td className="px-3 py-2 align-top text-muted-foreground">
        {row.data?.invite_email ?? ''}
      </td>
      <td className="px-3 py-2 align-top text-xs">
        <span className="font-medium">{t(`status.${row.status}`)}</span>
        {reason && <span className="ml-1 text-zinc-400">— {reason}</span>}
      </td>
    </tr>
  );
}
