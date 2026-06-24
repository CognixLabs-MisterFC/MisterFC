'use client';

/**
 * F13.10d — Selector de periodo de los informes PUBLICADOS en /mi-informe. Solo
 * lista los periodos compartidos (visibility='team'). Escribe ?informe= y recarga,
 * preservando ?player= y ?season=.
 */

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function ReportPeriodSelect({
  periods,
  current,
}: {
  periods: string[];
  current: string;
}) {
  const t = useTranslations('informes');
  const tFicha = useTranslations('mi_ficha');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{tFicha('report_period_label')}</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const np = new URLSearchParams(params);
          np.set('informe', e.target.value);
          start(() => router.replace(`${pathname}?${np.toString()}`));
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {periods.map((p) => (
          <option key={p} value={p}>
            {t(`period.${p}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
