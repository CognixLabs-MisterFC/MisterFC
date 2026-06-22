'use client';

/**
 * F13.5 — Filtro de visibilidad (staff/team) que escribe ?visibility= en la URL
 * (preserva el resto de params, resetea page). Patrón F2.10, igual que TeamSelect.
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
import type { PlayVisibility } from '../queries';

const ALL = '__all__';

export function PlayVisibilitySelect({ current }: { current: PlayVisibility | null }) {
  const t = useTranslations('jugadas');
  const tList = useTranslations('jugadas.list');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function onValueChange(value: string) {
    const np = new URLSearchParams(params);
    if (value === ALL) np.delete('visibility');
    else np.set('visibility', value);
    np.delete('page');
    startTransition(() => router.replace(`${pathname}?${np.toString()}`));
  }

  return (
    <Select value={current ?? ALL} onValueChange={onValueChange}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder={tList('visibility_all')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{tList('visibility_all')}</SelectItem>
        <SelectItem value="staff">{t('visibility.staff')}</SelectItem>
        <SelectItem value="team">{t('visibility.team')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
