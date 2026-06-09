'use client';

/**
 * Rework A (A4) — selector de temporada del listado de equipos. Escribe `?season=`
 * y deja que el server re-consulte. Mismo patrón que el filtro por equipo de
 * asistencia. La temporada activa va por defecto (la resuelve el server).
 */

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SeasonFilter({
  seasons,
  activeSeason,
}: {
  seasons: string[];
  activeSeason: string;
}) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setSeason(value: string) {
    const np = new URLSearchParams(params);
    np.set('season', value);
    router.replace(`${pathname}?${np.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="teams-season" className="text-sm text-muted-foreground">
        {t('season_filter')}
      </label>
      <select
        id="teams-season"
        value={activeSeason}
        onChange={(e) => setSeason(e.target.value)}
        className="h-8 rounded-md border border-border bg-card/30 px-2 text-sm"
      >
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
