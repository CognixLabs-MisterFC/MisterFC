'use client';

/**
 * F12.2b — Picker de ejercicios para añadir a un bloque. Reúsa el patrón del picker
 * de la pizarra (11B.1: Popover + buscador) + los filtros de la biblioteca (11.3:
 * categoría + objetivos). Pre-filtra por la CATEGORÍA del equipo de la sesión y los
 * OBJETIVOS de la cabecera (D8), ajustables por el entrenador. Filtra en cliente
 * (el set por club es modesto). Al elegir → onPick(id, name).
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import {
  CATEGORY_KINDS,
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChipGroup } from '@/components/ui/chip-group';
import type { PickableExercise } from '../queries';

function overlaps(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x));
}

export function ExercisePicker({
  exercises,
  defaultCategory,
  defaultTactical,
  defaultTechnical,
  onPick,
  disabled,
}: {
  exercises: PickableExercise[];
  defaultCategory: string | null;
  defaultTactical: string[];
  defaultTechnical: string[];
  onPick: (id: string, name: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('sesiones.picker');
  const tCategory = useTranslations('category_kinds');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [cats, setCats] = useState<string[]>(defaultCategory ? [defaultCategory] : []);
  const [tactical, setTactical] = useState<string[]>(defaultTactical);
  const [technical, setTechnical] = useState<string[]>(defaultTechnical);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises
      .filter((e) => {
        if (needle && !e.name.toLowerCase().includes(needle)) return false;
        if (cats.length > 0 && !overlaps(cats, e.categories)) return false;
        if (tactical.length > 0 && !overlaps(tactical, e.tactical_objectives)) return false;
        if (technical.length > 0 && !overlaps(technical, e.technical_objectives)) return false;
        return true;
      })
      .slice(0, 50);
  }, [exercises, q, cats, tactical, technical]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Plus className="size-4" aria-hidden />
          {t('add')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              className="pl-8"
              autoFocus
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {t('filters')}
          </button>

          {showFilters ? (
            <div className="flex max-h-48 flex-col gap-3 overflow-y-auto rounded-md border p-2">
              <ChipGroup
                label={t('category')}
                options={CATEGORY_KINDS}
                selected={cats}
                onToggle={(v) => toggle(cats, setCats, v)}
                labelFor={(v) => tCategory(v)}
              />
              <ChipGroup
                label={t('tactical')}
                options={TACTICAL_OBJECTIVES}
                selected={tactical}
                onToggle={(v) => toggle(tactical, setTactical, v)}
                labelFor={(v) => tTactical(v)}
              />
              <ChipGroup
                label={t('technical')}
                options={TECHNICAL_OBJECTIVES}
                selected={technical}
                onToggle={(v) => toggle(technical, setTechnical, v)}
                labelFor={(v) => tTechnical(v)}
              />
            </div>
          ) : null}

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="flex flex-col">
                {filtered.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(e.id, e.name);
                        setOpen(false);
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {e.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
