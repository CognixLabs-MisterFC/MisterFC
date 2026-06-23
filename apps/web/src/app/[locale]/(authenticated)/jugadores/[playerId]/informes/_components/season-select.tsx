'use client';

/**
 * F13.10b-1 — Selector de temporada del listado de informes: escribe ?season=
 * (label) y recarga. Sin JS también es navegable (es un <select> con submit por
 * cambio vía router).
 */

import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

export function SeasonSelect({
  seasons,
  current,
  label,
}: {
  seasons: ReadonlyArray<{ label: string }>;
  current: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={current}
        onChange={(e) => {
          const season = e.target.value;
          startTransition(() => {
            router.replace(`${pathname}?season=${encodeURIComponent(season)}`);
          });
        }}
        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
      >
        {seasons.map((s) => (
          <option key={s.label} value={s.label}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
