'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Filter, X } from 'lucide-react';
import { PLAYER_POSITIONS, type PlayerPosition } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

export type FilterTeam = { id: string; name: string; category_name: string };

type Props = {
  teams: FilterTeam[];
  /** Años disponibles, derivados de min/max DOB del club. Orden descendente. */
  years: number[];
  activeYears: number[];
  activePositions: string[];
  activeTeamIds: string[];
};

export function PlayersFilters({
  teams,
  years,
  activeYears,
  activePositions,
  activeTeamIds,
}: Props) {
  const t = useTranslations('jugadores.filters');
  const tPositions = useTranslations('jugadores.positions');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setMulti(key: 'year' | 'position' | 'team', values: string[]) {
    const next = new URLSearchParams(params);
    next.delete(key);
    for (const v of values) next.append(key, v);
    next.delete('page'); // reset paginación al cambiar el filtro
    router.replace(`${pathname}?${next.toString()}`);
  }

  function toggle(key: 'year' | 'position' | 'team', value: string, active: string[]) {
    const set = new Set(active);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setMulti(key, [...set]);
  }

  function clearAll() {
    const next = new URLSearchParams(params);
    next.delete('year');
    next.delete('position');
    next.delete('team');
    next.delete('q');
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  const activeCount =
    activeYears.length + activePositions.length + activeTeamIds.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="size-4" aria-hidden />
          <span>{t('label')}</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-foreground px-2 text-xs text-background">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-h-[70vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('title')}</h3>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={clearAll}
            >
              <X className="size-3" aria-hidden />
              {t('clear')}
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-4">
          <FilterGroup
            title={t('year_of_birth')}
            empty={t('empty_year')}
            items={years.map((y) => ({ id: String(y), label: String(y) }))}
            active={activeYears.map(String)}
            onToggle={(id) => toggle('year', id, activeYears.map(String))}
          />

          <FilterGroup
            title={t('position')}
            empty=""
            items={PLAYER_POSITIONS.map((p: PlayerPosition) => ({
              id: p,
              label: tPositions(p),
            }))}
            active={activePositions}
            onToggle={(id) => toggle('position', id, activePositions)}
          />

          <FilterGroup
            title={t('team')}
            empty={t('empty_team')}
            items={teams.map((tm) => ({
              id: tm.id,
              label: `${tm.name} · ${tm.category_name}`,
            }))}
            active={activeTeamIds}
            onToggle={(id) => toggle('team', id, activeTeamIds)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({
  title,
  empty,
  items,
  active,
  onToggle,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; label: string }>;
  active: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </Label>
      <div className="mt-1.5 flex flex-col gap-1">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          items.map((it) => (
            <label
              key={it.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                className="size-3.5 rounded border-border"
                checked={active.includes(it.id)}
                onChange={() => onToggle(it.id)}
              />
              <span>{it.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
