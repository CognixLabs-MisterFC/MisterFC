'use client';

/**
 * F13.10d — Selector de temporada en /mi-informe. Escribe ?season= y descarta
 * ?informe= (el periodo de otra temporada puede no existir), preservando ?player=.
 */

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SeasonSelect({
  seasons,
  current,
}: {
  seasons: string[];
  current: string;
}) {
  const t = useTranslations('mi_ficha');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('season_label')}</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const np = new URLSearchParams(params);
          np.set('season', e.target.value);
          np.delete('informe');
          start(() => router.replace(`${pathname}?${np.toString()}`));
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
