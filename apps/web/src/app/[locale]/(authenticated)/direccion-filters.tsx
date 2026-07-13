'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TeamOption, CoachOption } from './direccion-home-queries';

/**
 * F14E-2 — Filtros del Inicio de dirección: equipo y entrenador. Escriben
 * `?team=` / `?coach=` en la URL (server re-render). Por defecto "todos".
 */
export function DireccionFilters({
  teams,
  coaches,
  activeTeamId,
  activeCoachId,
}: {
  teams: TeamOption[];
  coaches: CoachOption[];
  activeTeamId: string;
  activeCoachId: string;
}) {
  const t = useTranslations('home');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  const selectCls =
    'h-9 rounded-md border border-border bg-background px-2 text-sm';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('direccion.filters.team')}
        <select
          className={selectCls}
          value={activeTeamId}
          onChange={(e) => setParam('team', e.target.value)}
        >
          <option value="">{t('direccion.filters.all_teams')}</option>
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('direccion.filters.coach')}
        <select
          className={selectCls}
          value={activeCoachId}
          onChange={(e) => setParam('coach', e.target.value)}
        >
          <option value="">{t('direccion.filters.all_coaches')}</option>
          {coaches.map((c) => (
            <option key={c.membershipId} value={c.membershipId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
