'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

const RANGES = ['7d', '30d', 'season'] as const;
type Range = (typeof RANGES)[number];

type Props = {
  active: Range;
};

// #7 — el filtro por equipo se movió a un control de página (TeamFilter, governa
// `?team=` para toda la vista). Aquí solo queda el rango temporal de las stats.
export function StatsRangeFilter({ active }: Props) {
  const t = useTranslations('asistencia.stats.range');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string | null) {
    const np = new URLSearchParams(params);
    if (value == null || value.length === 0) np.delete(key);
    else np.set(key, value);
    router.replace(`${pathname}?${np.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card/30 p-0.5">
      {RANGES.map((r) => (
        <Button
          key={r}
          type="button"
          size="sm"
          variant={r === active ? 'default' : 'ghost'}
          className="h-7"
          onClick={() => setParam('range', r)}
        >
          {t(r)}
        </Button>
      ))}
    </div>
  );
}
