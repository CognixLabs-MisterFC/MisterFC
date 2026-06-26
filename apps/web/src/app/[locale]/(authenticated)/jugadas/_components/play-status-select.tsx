'use client';

/**
 * JR-1 — Filtro por ESTADO del ciclo (borrador/propuesta/publicada/rechazada/
 * archivada) que escribe ?status= en la URL (preserva el resto de params, resetea
 * page). Sustituye al filtro de visibilidad de JR-0 (el modelo es banco del club
 * con estados, no por equipo). Patrón F2.10.
 */

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PlayStatusFilter } from '../queries';

const ALL = '__all__';
const OPTIONS: ReadonlyArray<PlayStatusFilter> = [
  'draft',
  'proposed',
  'published',
  'rejected',
  'archived',
];

export function PlayStatusSelect({ current }: { current: PlayStatusFilter | null }) {
  const t = useTranslations('jugadas');
  const tList = useTranslations('jugadas.list');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function onValueChange(value: string) {
    const np = new URLSearchParams(params);
    if (value === ALL) np.delete('status');
    else np.set('status', value);
    np.delete('page');
    startTransition(() => router.replace(`${pathname}?${np.toString()}`));
  }

  return (
    <Select value={current ?? ALL} onValueChange={onValueChange}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder={tList('status_all')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{tList('status_all')}</SelectItem>
        {OPTIONS.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`status.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
