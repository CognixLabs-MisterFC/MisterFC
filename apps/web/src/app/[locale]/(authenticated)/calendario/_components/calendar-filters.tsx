'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Filter, X } from 'lucide-react';
import { EVENT_TYPES, type EventType } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import type {
  CategoryOption,
  TeamOption,
} from '../queries';

type Props = {
  teams: TeamOption[];
  categories: CategoryOption[];
  activeTeamIds: string[];
  activeCategoryIds: string[];
  activeTypes: string[];
};

export function CalendarFilters({
  teams,
  categories,
  activeTeamIds,
  activeCategoryIds,
  activeTypes,
}: Props) {
  const t = useTranslations('calendario');
  const tTypes = useTranslations('calendario.types');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setMulti(key: 'team' | 'category' | 'type', values: string[]) {
    const next = new URLSearchParams(params);
    next.delete(key);
    for (const v of values) next.append(key, v);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function toggle(key: 'team' | 'category' | 'type', value: string, active: string[]) {
    const set = new Set(active);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setMulti(key, [...set]);
  }

  function clearAll() {
    const next = new URLSearchParams(params);
    next.delete('team');
    next.delete('category');
    next.delete('type');
    router.replace(`${pathname}?${next.toString()}`);
  }

  const activeCount =
    activeTeamIds.length + activeCategoryIds.length + activeTypes.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="size-4" aria-hidden />
          <span>{t('filters.label')}</span>
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
          <h3 className="text-sm font-semibold">{t('filters.title')}</h3>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={clearAll}
            >
              <X className="size-3" aria-hidden />
              {t('filters.clear')}
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-4">
          <FilterGroup
            title={t('filters.team')}
            empty={t('filters.empty_team')}
            items={teams.map((tm) => ({
              id: tm.id,
              label: `${tm.name} · ${tm.category_name}`,
            }))}
            active={activeTeamIds}
            onToggle={(id) => toggle('team', id, activeTeamIds)}
          />

          <FilterGroup
            title={t('filters.category')}
            empty={t('filters.empty_category')}
            items={categories.map((c) => ({
              id: c.id,
              label: `${c.name} · ${c.season}`,
            }))}
            active={activeCategoryIds}
            onToggle={(id) => toggle('category', id, activeCategoryIds)}
          />

          <FilterGroup
            title={t('filters.type')}
            empty=""
            items={EVENT_TYPES.map((ty: EventType) => ({
              id: ty,
              label: tTypes(ty),
            }))}
            active={activeTypes}
            onToggle={(id) => toggle('type', id, activeTypes)}
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
