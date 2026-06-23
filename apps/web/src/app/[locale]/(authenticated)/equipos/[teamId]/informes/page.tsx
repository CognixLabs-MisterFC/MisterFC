/**
 * F13.10 — Pantalla de Informes de desarrollo a nivel EQUIPO (panel/índice).
 * Tabla por equipo × temporada × periodo: 1ª fila = valoración de equipo; debajo,
 * una fila por jugador activo. El estado se CALCULA (reportStatus de core) sobre
 * las puntuaciones; la fecha límite queda preparada en blanco (la fija el admin en
 * 13.10g). Enlaza a los editores ya existentes (equipo e individual). Gate D13.
 *
 * La temporada es la del equipo (teams.season): un equipo pertenece a una sola
 * temporada, así que aquí no hay multi-selector de temporada (solo de periodo).
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  type ReportStatus,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodSelect } from './_components/period-select';
import {
  resolveSeasonId,
  loadActiveRoster,
  loadTeamReportScores,
  loadPlayerScoresByPlayer,
} from './queries';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
  searchParams: Promise<{ period?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

const STATUS_VARIANT: Record<ReportStatus, 'outline' | 'secondary' | 'default'> = {
  not_started: 'outline',
  in_progress: 'secondary',
  completed: 'default',
};

export default async function TeamReportsPage({ params, searchParams }: Props) {
  const { locale, teamId } = await params;
  const { period: periodParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!STAFF_ROLES.includes(ctx.activeClub.role as Role)) redirect(`/${locale}`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, season, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) notFound();
  const category = team.categories as unknown as { club_id: string };
  if (category.club_id !== clubId) notFound();

  const t = await getTranslations('informes');

  const seasonLabel = team.season as string;
  const seasonId = await resolveSeasonId(supabase, clubId, seasonLabel);
  const period = isDevelopmentPeriod(periodParam) ? periodParam : 'inicial';

  const roster = await loadActiveRoster(supabase, teamId);
  const teamScores = seasonId
    ? await loadTeamReportScores(supabase, teamId, seasonId, period)
    : null;
  const playerScores = seasonId
    ? await loadPlayerScoresByPlayer(supabase, teamId, seasonId, period)
    : new Map<string, Record<string, number>>();

  const teamStatus: ReportStatus =
    teamScores === null ? 'not_started' : reportStatus(teamScores, TEAM_REPORT_CATALOG);

  const seasonParam = encodeURIComponent(seasonLabel);
  const teamEditHref = `/equipos/${teamId}/informes/equipo/${period}`;

  const renderStatus = (s: ReportStatus) => (
    <Badge variant={STATUS_VARIANT[s]}>{t(`report_status.${s}`)}</Badge>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/equipos/${teamId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_team')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {team.name} · {seasonLabel}
          </p>
        </div>
        <PeriodSelect current={period} label={t('period_label')} />
      </div>

      {!seasonId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_season_for_team')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_subject')}</TableHead>
                  <TableHead>{t('col_status')}</TableHead>
                  <TableHead>{t('col_deadline')}</TableHead>
                  <TableHead className="text-right">{t('col_action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Fila 1: valoración de equipo */}
                <TableRow className="bg-muted/30">
                  <TableCell className="font-medium">{t('team_valuation')}</TableCell>
                  <TableCell>{renderStatus(teamStatus)}</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={teamEditHref}>{t('open_editor')}</Link>
                    </Button>
                  </TableCell>
                </TableRow>

                {/* Una fila por jugador activo */}
                {roster.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      {t('roster_empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  roster.map((m) => {
                    const scores = playerScores.get(m.playerId);
                    const status: ReportStatus =
                      scores === undefined
                        ? 'not_started'
                        : reportStatus(scores, DEVELOPMENT_REPORT_CATALOG);
                    return (
                      <TableRow key={m.playerId}>
                        <TableCell>
                          <span className="font-medium">{m.name}</span>
                          {m.dorsal != null ? (
                            <span className="ml-2 text-xs text-muted-foreground">#{m.dorsal}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{renderStatus(status)}</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link
                              href={`/jugadores/${m.playerId}/informes/${period}?season=${seasonParam}`}
                            >
                              {t('open_editor')}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
