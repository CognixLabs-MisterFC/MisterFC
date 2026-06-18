'use client';

/**
 * F12.2b — Picker de ejercicios para añadir a un bloque. La RECOMENDACIÓN es
 * implícita: la sesión ya tiene categoría (del equipo) + objetivos táctico/técnico,
 * así que al abrir muestra DIRECTAMENTE los ejercicios que encajan (sin controles de
 * filtro que aplicar). Solo un buscador por nombre + un "Ver todos" discreto por si
 * alguna vez se quiere uno que no encaje. Filtra en cliente (set por club modesto).
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  // ¿Hay criterio de recomendación? (si la sesión no tiene objetivos ni categoría,
  // "recomendados" = todos y el toggle no aporta nada).
  const hasCriteria =
    !!defaultCategory || defaultTactical.length > 0 || defaultTechnical.length > 0;

  function isRecommended(e: PickableExercise): boolean {
    if (defaultCategory && !e.categories.includes(defaultCategory)) return false;
    if (defaultTactical.length > 0 && !overlaps(defaultTactical, e.tactical_objectives)) return false;
    if (defaultTechnical.length > 0 && !overlaps(defaultTechnical, e.technical_objectives)) return false;
    return true;
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises
      .filter((e) => {
        if (needle && !e.name.toLowerCase().includes(needle)) return false;
        if (!showAll && hasCriteria && !isRecommended(e)) return false;
        return true;
      })
      .slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, q, showAll, hasCriteria, defaultCategory, defaultTactical, defaultTechnical]);

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

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-1 py-4 text-center">
                <p className="text-xs text-muted-foreground">{t('empty')}</p>
                {!showAll && hasCriteria ? (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {t('show_all')}
                  </button>
                ) : null}
              </div>
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

          {/* "Ver todos" discreto: solo tiene sentido si hay recomendación activa. */}
          {hasCriteria ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="self-center text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {showAll ? t('show_recommended') : t('show_all')}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
