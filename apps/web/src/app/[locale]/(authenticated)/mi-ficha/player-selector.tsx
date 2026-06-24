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
  activePlayerId: string;
  players: { id: string; name: string }[];
  /** Ruta destino (tras `/{locale}`). Por defecto `/mi-ficha`; `/mi-informe` la reusa. */
  basePath?: string;
};

/**
 * F9.5 — selector de jugador cuando la cuenta (familia) está vinculada a varios.
 * Navega con `?player=` y deja que el server recalcule (se descarta `season`
 * porque cada jugador tiene su propia trayectoria/temporadas).
 */
export function PlayerSelector({
  locale,
  activePlayerId,
  players,
  basePath = '/mi-ficha',
}: Props) {
  const t = useTranslations('mi_ficha');
  const router = useRouter();
  const [, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(() => {
      router.push(`/${locale}${basePath}?player=${next}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="mf-player">{t('player_selector')}</Label>
      <Select value={activePlayerId} onValueChange={onChange}>
        <SelectTrigger id="mf-player" className="w-full sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {players.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
