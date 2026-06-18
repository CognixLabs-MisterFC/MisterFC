'use client';

/**
 * F12.3 — Selector de equipo que escribe ?team= en la URL (preserva el resto de
 * params, resetea page). Reutilizado por el listado y la vista semana.
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
import type { ClubTeam } from '../queries';

const ALL = '__all__';

export function TeamSelect({
  teams,
  current,
  allowAll = true,
}: {
  teams: ClubTeam[];
  current: string | null;
  allowAll?: boolean;
}) {
  const t = useTranslations('sesiones.list');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function onValueChange(value: string) {
    const np = new URLSearchParams(params);
    if (value === ALL) np.delete('team');
    else np.set('team', value);
    np.delete('page');
    startTransition(() => router.replace(`${pathname}?${np.toString()}`));
  }

  return (
    <Select value={current ?? ALL} onValueChange={onValueChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder={t('team_all')} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? <SelectItem value={ALL}>{t('team_all')}</SelectItem> : null}
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name} · {team.season}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
