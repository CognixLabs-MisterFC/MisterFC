/**
 * F13.10 — Editor de la VALORACIÓN DE EQUIPO de un periodo, a nivel de equipo
 * (movido aquí desde la ruta de jugador: la valoración es del equipo, no de un
 * jugador). Reusa TeamReportEditor + ObjectivesSection (kind=team). Gate D13.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { STAFF_ROLES, createSupabaseServerClient, isDevelopmentPeriod, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { resolveSeasonId } from '../../queries';
import {
  loadTeamReport,
  loadTeamObjectives,
} from '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/queries';
import { TeamReportEditor } from '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/_components/team-report-editor';
import { ObjectivesSection } from '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/_components/objectives-section';

type Props = {
  params: Promise<{ locale: string; teamId: string; period: string }>;
};

export default async function TeamValuationEditorPage({ params }: Props) {
  const { locale, teamId, period } = await params;
  setRequestLocale(locale);

  if (!isDevelopmentPeriod(period)) notFound();

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

  const backHref = `/equipos/${teamId}/informes?period=${period}`;
  const teamReport = seasonId ? await loadTeamReport(supabase, teamId, seasonId, period) : null;
  const teamObjectives = seasonId ? await loadTeamObjectives(supabase, teamId, seasonId) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_team_reports')}</span>
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('team_valuation')} · {t(`period.${period}`)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {team.name} · {seasonLabel}
        </p>
      </div>

      {!seasonId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_season_for_team')}
          </CardContent>
        </Card>
      ) : (
        <>
          <TeamReportEditor
            teamId={teamId}
            seasonId={seasonId}
            period={period}
            initial={teamReport}
          />
          <ObjectivesSection kind="team" items={teamObjectives} playerId="" teamId={teamId} seasonId={seasonId} period={period} />
        </>
      )}
    </div>
  );
}
