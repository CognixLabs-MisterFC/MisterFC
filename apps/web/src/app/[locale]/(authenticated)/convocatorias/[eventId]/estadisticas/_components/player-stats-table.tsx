'use client';

/**
 * F7.x (X.1) — Tabla de estadísticas por jugador del partido. Ordenable por
 * columna; orden por defecto = el del loader (titulares primero, dorsal,
 * apellido). Solo presentación: recibe filas ya consolidadas (match_player_stats).
 */

import { useMemo, useState } from 'react';
import { formatPlayerNameNatural } from '@misterfc/core';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { MatchStatRow } from '../queries';

type NumKey =
  | 'minutesPlayed'
  | 'goals'
  | 'assists'
  | 'yellowCards'
  | 'redCards'
  | 'shots'
  | 'foulsCommitted'
  | 'foulsReceived'
  | 'penaltiesScored'
  | 'penaltiesMissed';

type SortKey = 'name' | 'started' | NumKey;
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;

const NUM_COLS: { key: NumKey; label: string }[] = [
  { key: 'minutesPlayed', label: 'col.minutes' },
  { key: 'goals', label: 'col.goals' },
  { key: 'assists', label: 'col.assists' },
  { key: 'yellowCards', label: 'col.yellow' },
  { key: 'redCards', label: 'col.red' },
  { key: 'shots', label: 'col.shots' },
  { key: 'foulsCommitted', label: 'col.fouls_committed' },
  { key: 'foulsReceived', label: 'col.fouls_received' },
  { key: 'penaltiesScored', label: 'col.pens_scored' },
  { key: 'penaltiesMissed', label: 'col.pens_missed' },
];

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active)
    return <ChevronsUpDown className="size-3 opacity-40" aria-hidden />;
  return dir === 'asc' ? (
    <ArrowUp className="size-3" aria-hidden />
  ) : (
    <ArrowDown className="size-3" aria-hidden />
  );
}

function HeadButton({
  sortKey,
  sort,
  onToggle,
  ariaLabel,
  className,
  children,
}: {
  sortKey: SortKey;
  sort: SortState;
  onToggle: (k: SortKey) => void;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 font-medium hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
      <SortIcon active={active} dir={active ? sort!.dir : 'desc'} />
    </button>
  );
}

export function PlayerStatsTable({ players }: { players: MatchStatRow[] }) {
  const t = useTranslations('estadisticas_partido');
  const [sort, setSort] = useState<SortState>(null);

  const rows = useMemo(() => {
    if (!sort) return players;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...players].sort((a, b) => {
      if (sort.key === 'name') {
        const an = `${a.lastName ?? ''} ${a.firstName}`.trim();
        const bn = `${b.lastName ?? ''} ${b.firstName}`.trim();
        return an.localeCompare(bn, 'es', { sensitivity: 'base' }) * dir;
      }
      if (sort.key === 'started') {
        return ((a.started ? 1 : 0) - (b.started ? 1 : 0)) * dir;
      }
      const av = (a[sort.key] as number | null) ?? -1;
      const bv = (b[sort.key] as number | null) ?? -1;
      return (av - bv) * dir;
    });
  }, [players, sort]);

  function toggle(key: SortKey) {
    setSort((cur) => {
      if (cur?.key === key) {
        return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      }
      // name arranca asc; numéricas/started arrancan desc.
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  }

  if (players.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('empty_no_players')}</p>
    );
  }

  const sortLabel = t('sort_by');

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-card">
              <HeadButton
                sortKey="name"
                sort={sort}
                onToggle={toggle}
                ariaLabel={sortLabel}
              >
                {t('col.player')}
              </HeadButton>
            </TableHead>
            <TableHead className="text-center">
              <HeadButton
                sortKey="started"
                sort={sort}
                onToggle={toggle}
                ariaLabel={sortLabel}
                className="justify-center"
              >
                {t('col.started')}
              </HeadButton>
            </TableHead>
            {NUM_COLS.map((c) => (
              <TableHead key={c.key} className="text-center">
                <HeadButton
                  sortKey={c.key}
                  sort={sort}
                  onToggle={toggle}
                  ariaLabel={sortLabel}
                  className="justify-center"
                >
                  <abbr title={t(c.label)} className="no-underline">
                    {t(`${c.label}_short`)}
                  </abbr>
                </HeadButton>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.playerId}>
              <TableCell className="sticky left-0 bg-card font-medium whitespace-nowrap">
                {p.dorsal != null && (
                  <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">
                    {p.dorsal}
                  </span>
                )}
                {formatPlayerNameNatural(p.firstName, p.lastName)}
              </TableCell>
              <TableCell className="text-center">
                {p.started ? (
                  <span className="text-foreground">{t('starter_yes')}</span>
                ) : (
                  <span className="text-muted-foreground">{t('starter_no')}</span>
                )}
              </TableCell>
              {NUM_COLS.map((c) => (
                <TableCell
                  key={c.key}
                  className="text-center tabular-nums text-muted-foreground"
                >
                  {p[c.key] as number}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
