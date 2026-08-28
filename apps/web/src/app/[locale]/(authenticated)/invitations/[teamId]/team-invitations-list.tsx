'use client';

import { useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { DireccionTeamInvitation, DireccionInvitationStatus } from '@misterfc/core';
import { CancelInvitationButton } from '../cancel-invitation-button';

type Filter = 'all' | 'pending' | 'expired' | 'accepted';

const FILTERS: Filter[] = ['all', 'pending', 'expired', 'accepted'];

const STATUS_BADGE: Record<DireccionInvitationStatus, string> = {
  pending: 'text-amber-400',
  expired: 'text-zinc-500',
  accepted: 'text-emerald-400',
};

/**
 * NIVEL 2 — listado de invitaciones de UN equipo con filtro de cuatro en cliente
 * (todas / pendientes / caducadas / aceptadas). Las filas vienen ya ordenadas del
 * loader (pendientes primero). El botón CANCELAR se reubica aquí (una por fila
 * cancelable); su `cancelInvitation` revalida server-side la ruta y el nivel 1.
 */
export function TeamInvitationsList({
  locale,
  rows,
}: {
  locale: string;
  rows: DireccionTeamInvitation[];
}) {
  const t = useTranslations('invitations');
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      expired: rows.filter((r) => r.status === 'expired').length,
      accepted: rows.filter((r) => r.status === 'accepted').length,
    }),
    [rows],
  );

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  function dateLabel(row: DireccionTeamInvitation): string {
    const date = format.dateTime(new Date(row.date), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (row.status === 'accepted') return t('date.accepted', { date });
    if (row.status === 'expired') return t('date.expired', { date });
    return t('date.expires', { date });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition ' +
              (filter === f
                ? 'border-[#10B981] bg-[#10B981]/10 text-[#10B981]'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white')
            }
          >
            {t(`filters.${f}`)} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-400">{t('empty_filter')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-white">{row.email}</div>
                <div className="text-xs text-zinc-400">
                  {t(`form.role_${row.role}`)} · {dateLabel(row)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={'text-xs ' + STATUS_BADGE[row.status]}>
                  {t(`status_${row.status}`)}
                </span>
                {row.status !== 'accepted' && (
                  <CancelInvitationButton
                    locale={locale}
                    invitationId={row.id}
                    email={row.email}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
