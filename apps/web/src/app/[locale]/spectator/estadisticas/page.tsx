import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BarChart3 } from 'lucide-react';
import { formatPlayerName } from '@misterfc/core';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadTeamSeasonStats } from '@/app/[locale]/(authenticated)/equipos/[teamId]/team-stats-queries';
import { MatchStatsByTypeTable } from '@/components/stats/match-stats-by-type-table';
import { buildTeamByTypeRows } from '@/lib/team-stats-rows';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14C-4 — ESTADÍSTICAS del equipo del nieto activo. REUTILIZA loadTeamSeasonStats
 * (RLS-driven; el seguidor lee match_player_stats club-wide por F14C-3) y los
 * componentes compartidos (MatchStatsByTypeTable, buildTeamByTypeRows,
 * formatPlayerName). SIN el gate STAFF ni el back-link a /equipos de la pantalla
 * de miembro (que queda intacta). Solo lectura.
 *
 * NOTA — clasificación de liga: la app no tiene hoy pantalla ni modelo de
 * standings (match_state solo guarda los marcadores del propio equipo). Queda
 * como pieza NUEVA fuera de F14C-4 (ver informe). Aquí se sirve la estadística
 * por jugador del equipo, que es lo reutilizable.
 */
export default async function SpectatorEstadisticasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) redirect(`/${locale}/`);

  const t = await getTranslations('spectator');
  const tStats = await getTranslations('equipo_stats');
  const tInf = await getTranslations('informes');

  const teamId = ctx.activePlayer.teamId;
  const data = teamId
    ? await loadTeamSeasonStats(teamId, { viewerIsSpectator: true })
    : null;

  const na = '—';

  if (!data || data.aggregate.perPlayer.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <StatsHeader title={t('estadisticas.title')} subtitle={t('estadisticas.subtitle', { name: ctx.activePlayer.fullName })} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('estadisticas.empty')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { team, aggregate, byType } = data;
  const { perPlayer } = aggregate;
  const pct = (v: number | null) => (v == null ? na : `${Math.round(v * 100)}%`);

  const COLS = [
    'matches',
    'starts',
    'minutes',
    'goals',
    'assists',
    'yellow',
    'red',
    'start_rate',
  ] as const;

  const teamByTypeRows = buildTeamByTypeRows(
    byType,
    (key) => tStats(`col_full.${key}`),
    na
  );
  const teamByTypeColumns = {
    friendly: tInf('ficha.friendly'),
    tournament: tInf('ficha.tournament'),
    official: tInf('ficha.official'),
    total: tInf('ficha.total'),
    rival: tStats('rival'),
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <StatsHeader
        title={t('estadisticas.title')}
        subtitle={`${team.name} · ${team.category_name} · ${team.season}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>{tStats('by_type_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MatchStatsByTypeTable columns={teamByTypeColumns} rows={teamByTypeRows} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tStats('by_player_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{tStats('col.dorsal')}</th>
                  <th className="px-3 py-2 font-medium">{tStats('col.player')}</th>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-right font-medium"
                      title={tStats(`col_full.${c}`)}
                    >
                      {tStats(`col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perPlayer.map((p) => (
                  <tr
                    key={p.player_id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {p.dorsal_in_team != null ? `#${p.dorsal_in_team}` : na}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {formatPlayerName(p.first_name, p.last_name)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.matches}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.starts}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.minutesPlayed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.goals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.assists}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.yellowCards}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stats.redCards}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(p.ratios.startRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatsHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <BarChart3 className="size-6" aria-hidden />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
