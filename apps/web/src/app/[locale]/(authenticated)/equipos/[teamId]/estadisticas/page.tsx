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
import {
  MatchStatsByTypeTable,
  type MatchStatsByTypeRow,
} from '@/components/stats/match-stats-by-type-table';

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
  // F9B-4a — etiquetas de columnas del desglose reutilizadas del informe/perfil.
  const tInf = await getTranslations('informes');
  const { team, aggregate, byType } = data;
  const { perPlayer } = aggregate;

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

  // F9B-4a — bloque "Totales del equipo" por tipo (Amistoso·Torneo·Oficial·Total),
  // con el componente compartido (#270). Solo métricas SUMMABLES (Σ de
  // match_player_stats); corners/offsides/rival/marcador son F9B-4b. La fila
  // Partidos usa partidos REALES por tipo (distinct event_id), no Σ de apariciones.
  const cellVal = (
    key: string,
    agg: (typeof byType.stats)['total'],
  ): string => {
    switch (key) {
      case 'goals':
        return String(agg.goals);
      case 'assists':
        return String(agg.assists);
      case 'shots':
        return String(agg.shots);
      case 'fouls_committed':
        return String(agg.foulsCommitted);
      case 'fouls_received':
        return String(agg.foulsReceived);
      case 'yellow':
        return String(agg.yellowCards);
      case 'red':
        return String(agg.redCards);
      case 'penalties_scored':
        return String(agg.penaltiesScored);
      case 'penalties_missed':
        return String(agg.penaltiesMissed);
      case 'minutes':
        return String(agg.minutesPlayed);
      case 'start_rate':
        // Titularidad del equipo = Σtitularidades / Σapariciones (denominador
        // = apariciones, no partidos reales), como el startRate del jugador.
        return pct(agg.matches > 0 ? agg.starts / agg.matches : null);
      default:
        return na;
    }
  };
  const TEAM_METRIC_KEYS = [
    'goals',
    'assists',
    'shots',
    'fouls_committed',
    'fouls_received',
    'yellow',
    'red',
    'penalties_scored',
    'penalties_missed',
    'minutes',
    'start_rate',
  ] as const;
  // Fila "Partidos": partidos reales por tipo (distinct event_id).
  const matchesRow: MatchStatsByTypeRow = {
    key: 'matches',
    label: t('col_full.matches'),
    cells: {
      amistoso: String(byType.matches.amistoso),
      torneo: String(byType.matches.torneo),
      oficial: String(byType.matches.oficial),
      total: String(byType.matches.total),
    },
  };
  const teamByTypeRows: MatchStatsByTypeRow[] = [
    matchesRow,
    ...TEAM_METRIC_KEYS.map((key) => ({
      key,
      label: t(`col_full.${key}`),
      cells: {
        amistoso: cellVal(key, byType.stats.amistoso),
        torneo: cellVal(key, byType.stats.torneo),
        oficial: cellVal(key, byType.stats.oficial),
        total: cellVal(key, byType.stats.total),
      },
    })),
  ];
  const teamByTypeColumns = {
    friendly: tInf('ficha.friendly'),
    tournament: tInf('ficha.tournament'),
    official: tInf('ficha.official'),
    total: tInf('ficha.total'),
  };

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

      {/* F9B-4a — Totales del equipo por tipo (Amistoso·Torneo·Oficial·Total),
          encima de la tabla por jugador. Solo métricas summables (4a). */}
      <Card>
        <CardHeader>
          <CardTitle>{t('by_type_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {perPlayer.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <MatchStatsByTypeTable
              columns={teamByTypeColumns}
              rows={teamByTypeRows}
            />
          )}
        </CardContent>
      </Card>

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
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
