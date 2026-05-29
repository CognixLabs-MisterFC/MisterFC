'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DEBOUNCE_MS = 250;

export function PlayersSearchInput() {
  const t = useTranslations('jugadores.filters');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';

  const [value, setValue] = useState(initial);
  const [lastSyncedInitial, setLastSyncedInitial] = useState(initial);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza si la URL cambia por otra fuente (clear all, nav externa).
  // Patrón render-phase compare en lugar de useEffect para evitar
  // `react-hooks/set-state-in-effect` y reducir el lag de un tick extra.
  if (initial !== lastSyncedInitial) {
    setLastSyncedInitial(initial);
    setValue(initial);
  }

  function push(next: string) {
    const np = new URLSearchParams(params);
    if (next.length > 0) np.set('q', next);
    else np.delete('q');
    np.delete('page'); // reset pagination al cambiar el filtro
    startTransition(() => {
      router.replace(`${pathname}?${np.toString()}`);
    });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), DEBOUNCE_MS);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setValue('');
    push('');
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        placeholder={t('search_placeholder')}
        value={value}
        onChange={onChange}
        aria-label={t('search_label')}
        className="pl-8 pr-8"
      />
      {value.length > 0 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-0 top-0 h-9 w-9"
          onClick={clear}
          aria-label={t('search_clear')}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}
