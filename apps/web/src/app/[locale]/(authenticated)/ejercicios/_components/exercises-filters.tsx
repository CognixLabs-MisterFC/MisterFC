'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Filter, X } from 'lucide-react';
import {
  CATEGORY_KINDS,
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  SESSION_BLOCK_TYPES,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

type UrlKey = 'tactical' | 'technical' | 'category' | 'intensity' | 'space' | 'phase';

type Props = {
  activeTactical: string[];
  activeTechnical: string[];
  activeCategories: string[];
  activeIntensity: string[];
  activeSpaceType: string[];
  activePhases: string[];
};

/** Filtros multi-select en la URL (patrón F2.10). Vocabularios de @misterfc/core;
 *  etiquetas localizadas (los valores de dominio están en español sin traducir). */
export function ExercisesFilters({
  activeTactical,
  activeTechnical,
  activeCategories,
  activeIntensity,
  activeSpaceType,
  activePhases,
}: Props) {
  const t = useTranslations('ejercicios.filters');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');
  const tCategory = useTranslations('category_kinds');
  const tIntensity = useTranslations('ejercicios.intensity_values');
  const tSpace = useTranslations('ejercicios.space_types');
  const tPhase = useTranslations('sesiones.block_types');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setMulti(key: UrlKey, values: string[]) {
    const next = new URLSearchParams(params);
    next.delete(key);
    for (const v of values) next.append(key, v);
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  function toggle(key: UrlKey, value: string, active: string[]) {
    const set = new Set(active);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setMulti(key, [...set]);
  }

  function clearAll() {
    const next = new URLSearchParams(params);
    for (const k of ['tactical', 'technical', 'category', 'intensity', 'space', 'phase', 'q', 'page']) {
      next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  const activeCount =
    activeTactical.length +
    activeTechnical.length +
    activeCategories.length +
    activeIntensity.length +
    activeSpaceType.length +
    activePhases.length;

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
      <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto">
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
            title={t('tactical')}
            items={TACTICAL_OBJECTIVES.map((v) => ({ id: v, label: tTactical(v) }))}
            active={activeTactical}
            onToggle={(id) => toggle('tactical', id, activeTactical)}
          />
          <FilterGroup
            title={t('technical')}
            items={TECHNICAL_OBJECTIVES.map((v) => ({ id: v, label: tTechnical(v) }))}
            active={activeTechnical}
            onToggle={(id) => toggle('technical', id, activeTechnical)}
          />
          <FilterGroup
            title={t('category')}
            items={CATEGORY_KINDS.map((v) => ({ id: v, label: tCategory(v) }))}
            active={activeCategories}
            onToggle={(id) => toggle('category', id, activeCategories)}
          />
          <FilterGroup
            title={t('phase')}
            items={SESSION_BLOCK_TYPES.map((v) => ({ id: v, label: tPhase(v) }))}
            active={activePhases}
            onToggle={(id) => toggle('phase', id, activePhases)}
          />
          <FilterGroup
            title={t('intensity')}
            items={EXERCISE_INTENSITIES.map((v) => ({ id: v, label: tIntensity(v) }))}
            active={activeIntensity}
            onToggle={(id) => toggle('intensity', id, activeIntensity)}
          />
          <FilterGroup
            title={t('space_type')}
            items={EXERCISE_SPACE_TYPES.map((v) => ({ id: v, label: tSpace(v) }))}
            active={activeSpaceType}
            onToggle={(id) => toggle('space', id, activeSpaceType)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({
  title,
  items,
  active,
  onToggle,
}: {
  title: string;
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
        {items.map((it) => (
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
        ))}
      </div>
    </div>
  );
}
