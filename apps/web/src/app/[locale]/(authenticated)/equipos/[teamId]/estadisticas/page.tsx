/**
 * F9.B-3 — Estadísticas agregadas del equipo en su temporada (vista staff).
 *
 * Consume `loadTeamSeasonStats` (9.B-0): tabla por jugador + fila de TOTALES del
 * equipo. Print-friendly (de cara al PDF de equipo, 9.B-7) — el botón "Exportar
 * PDF" queda como hueco deshabilitado hasta esa subfase.
 *
 * Acceso: admin/coord (cualquier equipo del club) o coach (solo sus equipos,
 * vía `userStaffsTeam`). La RLS de 9.B-0 ya recorta las stats; aquí solo gating
 * de navegación. Sin política nueva.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Download } from 'lucide-react';
import { formatPlayerName, type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadTeamSeasonStats } from '../team-stats-queries';
import { userStaffsTeam } from '../../../estadisticas-equipo/queries';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];
const COACH_ROLES: ReadonlyArray<Role> = [
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function TeamStatsPage({ params }: Props) {
  const { locale, teamId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}/perfil`);

  const data = await loadTeamSeasonStats(teamId);
  if (!data) notFound();
  // Solo equipos del club activo.
  if (data.team.club_id !== ctx.activeClub.club.id) notFound();
  // El coach solo ve SUS equipos (admin/coord ven cualquiera del club).
  if (COACH_ROLES.includes(role)) {
    const ok = await userStaffsTeam(ctx.activeClub.membershipId, teamId);
    if (!ok) notFound();
  }

  const t = await getTranslations('equipo_stats');
  const { team, aggregate } = data;
  const { perPlayer, totals, totalsRatios } = aggregate;

  const na = '—';
  const pct = (v: number | null) => (v == null ? na : `${Math.round(v * 100)}%`);

  // Columnas (cortas) de la tabla por jugador.
  const COLS = [
    { key: 'matches', align: 'right' },
    { key: 'starts', align: 'right' },
    { key: 'minutes', align: 'right' },
    { key: 'goals', align: 'right' },
    { key: 'assists', align: 'right' },
    { key: 'yellow', align: 'right' },
    { key: 'red', align: 'right' },
    { key: 'start_rate', align: 'right' },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/equipos/${teamId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="size-4 shrink-0 rounded-sm"
            style={{ backgroundColor: team.color }}
            aria-hidden
          />
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">
              {team.name} · {team.category_name} · {team.season}
            </p>
          </div>
        </div>
        {/* PDF de equipo (9.B-7): Route Handler que hereda la RLS. */}
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={`/${locale}/equipos/${teamId}/estadisticas/pdf`}>
            <Download className="size-4" aria-hidden />
            <span>{t('export_pdf')}</span>
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('by_player_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {perPlayer.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('col.dorsal')}</th>
                    <th className="px-3 py-2 font-medium">{t('col.player')}</th>
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        className="px-3 py-2 text-right font-medium"
                        title={t(`col_full.${c.key}`)}
                      >
                        {t(`col.${c.key}`)}
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
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.matches}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.starts}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.minutesPlayed}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.goals}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.assists}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.yellowCards}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stats.redCards}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {pct(p.ratios.startRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">{t('totals_row')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.matches}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.starts}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.minutesPlayed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.goals}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.assists}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.yellowCards}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.redCards}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(totalsRatios.startRate)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
