'use client';

/**
 * #7 — Filtro por equipo de la vista de asistencia (admin/coordinador, o coach
 * con varios equipos). Escribe `?team=` y deja que el server re-consulte; aplica
 * a TODA la página (entrenamientos recientes + pendientes + stats). "Todos" por
 * defecto. No cambia el scoping por rol: las opciones ya vienen acotadas a los
 * equipos visibles del usuario y la query intersecta con su scope.
 */

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function TeamFilter({
  teams,
  activeTeamId,
}: {
  teams: Array<{ id: string; name: string }>;
  activeTeamId: string | null;
}) {
  const t = useTranslations('asistencia');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setTeam(value: string | null) {
    const np = new URLSearchParams(params);
    if (!value) np.delete('team');
    else np.set('team', value);
    router.replace(`${pathname}?${np.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="att-team" className="text-sm text-muted-foreground">
        {t('team_filter')}
      </label>
      <select
        id="att-team"
        value={activeTeamId ?? ''}
        onChange={(e) => setTeam(e.target.value || null)}
        className="h-8 rounded-md border border-border bg-card/30 px-2 text-sm"
      >
        <option value="">{t('team_all')}</option>
        {teams.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {tm.name}
          </option>
        ))}
      </select>
    </div>
  );
}
