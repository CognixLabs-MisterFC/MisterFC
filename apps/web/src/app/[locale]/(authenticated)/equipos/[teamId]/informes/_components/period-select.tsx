'use client';

/**
 * F13.10 — Selector de periodo de la pantalla de informes de equipo: escribe
 * ?period= y recarga (la temporada es la del equipo, fija). Patrón SeasonSelect.
 */

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { DEVELOPMENT_PERIODS } from '@misterfc/core';
import { usePathname, useRouter } from '@/i18n/navigation';

export function PeriodSelect({ current, label }: { current: string; label: string }) {
  const t = useTranslations('informes');
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={current}
        onChange={(e) => {
          const period = e.target.value;
          startTransition(() => {
            router.replace(`${pathname}?period=${encodeURIComponent(period)}`);
          });
        }}
        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
      >
        {DEVELOPMENT_PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(`period.${p}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
