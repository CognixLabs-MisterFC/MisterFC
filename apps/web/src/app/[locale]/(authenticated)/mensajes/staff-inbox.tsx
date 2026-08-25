'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export type InboxListItem = {
  kind: 'direct' | 'group' | 'staff';
  key: string;
  href: string;
  title: string;
  last: string;
  unread: number;
};

type Filter = 'todos' | 'club' | 'familias' | 'equipo';

type Props = { locale: string; items: InboxListItem[] };

/**
 * O2-12 — Lista del inbox del STAFF con el filtro de 4 (TODOS/CLUB/FAMILIAS/EQUIPO).
 * SOLO se monta para usuarios con `canMessage` (staff); las familias renderizan la
 * lista server-side de siempre, sin este componente ni el filtro. El estado del filtro
 * es local y NO persiste (arranca en TODOS). Los ítems ya vienen fusionados y ordenados
 * por fecha desde el server.
 */
export function StaffInbox({ locale, items }: Props) {
  const t = useTranslations('mensajes');
  const [filter, setFilter] = useState<Filter>('todos');

  const rows = items.filter((it) =>
    filter === 'todos'
      ? true
      : filter === 'club'
        ? it.kind === 'staff'
        : filter === 'familias'
          ? it.kind === 'direct'
          : it.kind === 'group',
  );

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'todos', label: t('filter.all') },
    { key: 'club', label: t('filter.club') },
    { key: 'familias', label: t('filter.families') },
    { key: 'equipo', label: t('filter.team') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-misterfc-green bg-misterfc-green/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/30'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  {item.kind === 'group' ? (
                    <UsersRound
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : item.kind === 'staff' ? (
                    <Building2
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : null}
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {item.kind === 'group'
                        ? t('list.group_label', { team: item.title })
                        : item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.last).toLocaleString(locale)}
                    </span>
                  </div>
                </div>
                {item.unread > 0 && (
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-misterfc-green px-2 text-xs font-semibold text-zinc-900">
                    {item.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
