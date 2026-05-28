'use client';

import { useTranslations } from 'next-intl';
import { PLAYER_POSITIONS } from '@misterfc/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
  currentPosition: string | null;
};

export function PositionFilter({ currentPosition }: Props) {
  const t = useTranslations('jugadores.positions');
  const tMP = useTranslations('mi_plantilla');
  const router = useRouter();
  const searchParams = useSearchParams();

  function setPosition(p: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (p) next.set('position', p);
    else next.delete('position');
    router.push(`?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant={currentPosition === null ? 'default' : 'outline'}
        onClick={() => setPosition(null)}
      >
        {tMP('filter.all')}
      </Button>
      {PLAYER_POSITIONS.map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant={currentPosition === p ? 'default' : 'outline'}
          onClick={() => setPosition(p)}
        >
          {t(p)}
        </Button>
      ))}
    </div>
  );
}
