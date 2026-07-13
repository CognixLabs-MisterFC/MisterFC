'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  locale: string;
  activeTeamId: string;
  teams: { id: string; name: string; category_name: string }[];
  /** Ruta base a la que navega el selector (default /mi-equipo). F14E-6 lo reutiliza
   *  para /mi-equipo/plantilla sin cambiar el comportamiento de /mi-equipo. */
  basePath?: string;
};

/**
 * F5.8 — selector de equipo cuando el jugador está en varios teams.
 * Actualiza el query param `team` y navega — el server component re-render.
 */
export function TeamSelectorWrapper({
  locale,
  activeTeamId,
  teams,
  basePath = '/mi-equipo',
}: Props) {
  const t = useTranslations('mi_equipo');
  const router = useRouter();
  const [, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(() => {
      router.push(`/${locale}${basePath}?team=${next}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="me-team">{t('team_selector')}</Label>
      <Select value={activeTeamId} onValueChange={onChange}>
        <SelectTrigger id="me-team" className="w-full sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teams.map((tm) => (
            <SelectItem key={tm.id} value={tm.id}>
              {tm.name} · {tm.category_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
