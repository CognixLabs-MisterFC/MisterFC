'use client';

/**
 * JS-1 (F12↔F13) — Picker de JUGADAS para añadir a un bloque de la sesión. El origen
 * es el PLAYBOOK del equipo de la sesión (todas las seleccionadas, sin importar
 * shared_with_family — entrenar ≠ compartir). Filtra en cliente por nombre y excluye
 * las ya añadidas al bloque (`excludeIds`). Si la sesión no tiene equipo (plantilla)
 * no hay playbook → avisa (D4). Espeja el patrón del exercise-picker.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AddableSessionPlay } from '../queries';

export function PlayPicker({
  plays,
  excludeIds,
  hasTeam,
  onPick,
  disabled,
}: {
  plays: AddableSessionPlay[];
  /** Jugadas ya añadidas a este bloque (se ocultan del listado). */
  excludeIds: string[];
  /** La sesión tiene equipo: si no, no hay playbook (plantilla) → avisa. */
  hasTeam: boolean;
  onPick: (id: string, name: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('sesiones.play_picker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return plays
      .filter((p) => {
        if (exclude.has(p.id)) return false;
        if (needle && !(p.name ?? '').toLowerCase().includes(needle)) return false;
        return true;
      })
      .slice(0, 50);
  }, [plays, q, exclude]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || !hasTeam}>
          <Swords className="size-4" aria-hidden />
          {t('add')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        {!hasTeam ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t('no_team')}</p>
        ) : (
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
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  {plays.length === 0 ? t('empty_playbook') : t('empty')}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(p.id, p.name ?? t('untitled'));
                          setOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 truncate">{p.name ?? t('untitled')}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('frame_count', { count: p.frame_count })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
