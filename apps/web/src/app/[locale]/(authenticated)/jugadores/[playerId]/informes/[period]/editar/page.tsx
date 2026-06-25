/**
 * F13.10 — EDITOR del informe individual de un periodo (antes en [period]; ahora
 * [period] es la ficha de solo-lectura y el editor vive aquí). Arriba, la parte de
 * EQUIPO fija/no editable; debajo, lo individual (catálogo + comentario) +
 * objetivos. Gate D13.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Info } from 'lucide-react';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  TEAM_REPORT_CATALOG,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadTeamReport,
  loadPlayerObjectives,
  loadTeamObjectives,
} from '../../queries';
import { ScoreGrid } from '../../_components/score-grid';
import { IndividualReportEditor } from '../../_components/individual-report-editor';
import { ObjectivesSection } from '../../_components/objectives-section';

type Props = {
  params: Promise<{ locale: string; playerId: string; period: string }>;
  searchParams: Promise<{ season?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function InformeEditorPage({ params, searchParams }: Props) {
  const { locale, playerId, period } = await params;
  const { season: seasonParam } = await searchParams;
  setRequestLocale(locale);

  if (!isDevelopmentPeriod(period)) notFound();

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!STAFF_ROLES.includes(ctx.activeClub.role as Role)) redirect(`/${locale}`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  const { data: player } = await supabase
    .from('players')
    .select('id, club_id, first_name, last_name')
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== clubId) notFound();

  const t = await getTranslations('informes');

  const seasons = await loadClubSeasons(supabase, clubId);
  const activeLabel = await getActiveSeasonLabel(supabase, clubId);
  const selectedLabel =
    seasonParam && seasons.some((s) => s.label === seasonParam) ? seasonParam : activeLabel;
  const selectedSeason = seasons.find((s) => s.label === selectedLabel) ?? null;
  const team = await resolvePlayerTeamForSeason(supabase, playerId, selectedLabel);
  const seasonId = selectedSeason?.id ?? null;

  const seasonQs = `?season=${encodeURIComponent(selectedLabel)}`;
  const backHref = `/jugadores/${playerId}/informes/${period}${seasonQs}`;
  const teamHref = team ? `/equipos/${team.teamId}/informes/equipo/${period}` : backHref;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  const report =
    team && seasonId ? await loadIndividualReport(supabase, playerId, seasonId, period) : null;
  const teamReport =
    team && seasonId ? await loadTeamReport(supabase, team.teamId, seasonId, period) : null;
  const teamObjectives =
    team && seasonId ? await loadTeamObjectives(supabase, team.teamId, seasonId) : [];
  const playerObjectives =
    seasonId ? await loadPlayerObjectives(supabase, playerId, seasonId) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_report')}</span>
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {fullName} · {t(`period.${period}`)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {team ? team.teamName : ''} · {selectedLabel}
        </p>
      </div>

      {!team || !seasonId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team_for_season')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Bloque de EQUIPO (fijo, no editable) ──────────────────────── */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">{t('team_block_title')}</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href={teamHref}>{t('edit_team_valuation')}</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {teamReport ? (
                <>
                  <ScoreGrid catalog={TEAM_REPORT_CATALOG} initial={teamReport.scores} readOnly />
                  {teamReport.comment ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{t('team_comment')}</span>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {teamReport.comment}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t('objectives_team')}</span>
                    {teamObjectives.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('no_objectives')}</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {teamObjectives.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{o.title}</span>
                            <Badge variant="secondary">{t(`status.${o.status}`)}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    {t('team_block_missing')}{' '}
                    <Link href={teamHref} className="font-medium text-foreground underline">
                      {t('create_team_valuation')}
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Informe INDIVIDUAL (editable) ─────────────────────────────── */}
          <IndividualReportEditor
            playerId={playerId}
            teamId={team.teamId}
            seasonId={seasonId}
            period={period}
            initial={report}
          />

          <ObjectivesSection
            kind="player"
            items={playerObjectives}
            playerId={playerId}
            teamId={team.teamId}
            seasonId={seasonId}
            period={period}
          />
        </>
      )}
    </div>
  );
}
