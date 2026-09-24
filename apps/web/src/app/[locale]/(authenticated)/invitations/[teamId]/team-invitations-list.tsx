'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DireccionTeamInvitation, DireccionInvitationStatus } from '@misterfc/core';
import { CancelInvitationButton } from '../cancel-invitation-button';
import { intlLocale } from '@/lib/intl-locale';

type Filter = 'all' | 'pending' | 'expired' | 'accepted' | 'not_delivered';

const FILTERS: Filter[] = ['all', 'pending', 'expired', 'accepted', 'not_delivered'];

const STATUS_BADGE: Record<DireccionInvitationStatus, string> = {
  pending: 'text-amber-400',
  expired: 'text-zinc-500',
  accepted: 'text-emerald-400',
};

/**
 * A-3 — la marca de ENTREGA, que no sustituye al estado: lo acompaña. Una invitación
 * puede estar Pendiente y además no haber llegado, y hasta ahora las dos se veían igual.
 *
 * `ok` no pinta nada a propósito: el silencio es la buena noticia y casi todas están
 * bien; una marca por fila convertiría la pantalla en ruido y enterraría las dos que
 * importan. Rojo para lo que no llegó (hay que hacer algo hoy), ámbar apagado para lo
 * que no sabemos.
 */
const DELIVERY_BADGE: Record<'failed' | 'unconfirmed', string> = {
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
  unconfirmed: 'border-amber-500/30 bg-amber-500/5 text-amber-300/80',
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
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      expired: rows.filter((r) => r.status === 'expired').length,
      accepted: rows.filter((r) => r.status === 'accepted').length,
      // A-3 — corte transversal, no una quinta categoría: una que no llegó sigue
      // contando además en el filtro donde esté (casi siempre, en pendientes).
      not_delivered: rows.filter((r) => r.delivery === 'failed').length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'not_delivered') return rows.filter((r) => r.delivery === 'failed');
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  function dateLabel(row: DireccionTeamInvitation): string {
    // `format.dateTime` de next-intl usa el locale DEL CONTEXTO, que es `va` tal cual:
    // el mismo agujero que el resto, solo que escondido detrás del hook.
    const date = new Intl.DateTimeFormat(intlLocale(locale), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(row.date));
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
                {/* El motivo, debajo y solo cuando lo hay: es lo que convierte un
                    "no llegó" en algo que se puede arreglar (un correo mal escrito,
                    un buzón lleno). Lo escribe Resend, así que no se traduce. */}
                {row.delivery === 'failed' && row.delivery_detail && (
                  <div className="truncate text-xs text-red-300/70" title={row.delivery_detail}>
                    {row.delivery_detail}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {row.delivery !== 'ok' && (
                  <span
                    className={
                      'rounded-full border px-2 py-0.5 text-xs ' + DELIVERY_BADGE[row.delivery]
                    }
                    title={t(`delivery_${row.delivery}_hint`)}
                  >
                    {t(`delivery_${row.delivery}`)}
                  </span>
                )}
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
