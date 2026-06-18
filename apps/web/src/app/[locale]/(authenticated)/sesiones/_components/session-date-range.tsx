'use client';

/**
 * F12.3 — Filtro de rango de fechas del listado (?from / ?to en la URL; resetea
 * page). Inputs de fecha nativos.
 */

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SessionDateRange({ from, to }: { from: string | null; to: string | null }) {
  const t = useTranslations('sesiones.list');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: 'from' | 'to', value: string) {
    const np = new URLSearchParams(params);
    if (value) np.set(key, value);
    else np.delete(key);
    np.delete('page');
    startTransition(() => router.replace(`${pathname}?${np.toString()}`));
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="from" className="text-xs text-muted-foreground">
          {t('date_from')}
        </Label>
        <Input
          id="from"
          type="date"
          value={from ?? ''}
          onChange={(e) => setParam('from', e.target.value)}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to" className="text-xs text-muted-foreground">
          {t('date_to')}
        </Label>
        <Input
          id="to"
          type="date"
          value={to ?? ''}
          onChange={(e) => setParam('to', e.target.value)}
          className="w-40"
        />
      </div>
    </div>
  );
}
