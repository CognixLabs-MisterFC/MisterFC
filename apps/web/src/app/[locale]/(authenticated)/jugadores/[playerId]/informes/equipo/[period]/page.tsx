/**
 * F13.10-editor — Editor de la VALORACIÓN DE EQUIPO de un periodo (paso 1 del
 * flujo: la valoración grupal va antes que los informes individuales). Catálogo
 * TEAM + comentario de equipo + objetivos grupales (CRUD). Gate D13.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient, isDevelopmentPeriod, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadTeamReport,
  loadTeamObjectives,
} from '../../queries';
import { TeamReportEditor } from '../../_components/team-report-editor';
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

export default async function TeamReportEditorPage({ params, searchParams }: Props) {
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

  const backHref = `/jugadores/${playerId}/informes?season=${encodeURIComponent(selectedLabel)}`;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  const teamReport =
    team && seasonId ? await loadTeamReport(supabase, team.teamId, seasonId, period) : null;
  const teamObjectives =
    team && seasonId ? await loadTeamObjectives(supabase, team.teamId, seasonId) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_reports')}</span>
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('team_valuation')} · {t(`period.${period}`)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {team ? team.teamName : fullName} · {selectedLabel}
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
          <TeamReportEditor
            playerId={playerId}
            teamId={team.teamId}
            seasonId={seasonId}
            period={period}
            initial={teamReport}
          />
          <ObjectivesSection
            kind="team"
            items={teamObjectives}
            playerId={playerId}
            teamId={team.teamId}
            seasonId={seasonId}
          />
        </>
      )}
    </div>
  );
}
