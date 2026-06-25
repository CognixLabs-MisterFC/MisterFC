/**
 * F13.10 — FICHA (vista staff, read-only) del informe individual de un periodo.
 * El cuerpo de la ficha es el componente compartido ReportFichaView (mismo que la
 * vista familia en /mi-ficha). Aquí se añaden los controles staff: volver, editar
 * y publicar/despublicar. Gate D13.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Pencil, Download } from 'lucide-react';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  PLAYER_POSITIONS,
  type PlayerPosition,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadTeamReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadPlayerEvolution,
  loadTeamEvolution,
} from '../queries';
import { PublishToggle } from '../_components/publish-toggle';
import { ReportFichaView } from '../_components/report-ficha-view';

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

const PHOTO_TTL = 3600;

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export default async function InformeFichaPage({ params, searchParams }: Props) {
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
    .select(
      'id, club_id, first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url',
    )
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
  const backHref = `/jugadores/${playerId}/informes${seasonQs}`;
  const editHref = `/jugadores/${playerId}/informes/${period}/editar${seasonQs}`;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  let photoUrl: string | null = null;
  if (player.photo_url) {
    const { data } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(player.photo_url, PHOTO_TTL);
    photoUrl = data?.signedUrl ?? null;
  }

  const report =
    team && seasonId ? await loadIndividualReport(supabase, playerId, seasonId, period) : null;
  const teamReport =
    team && seasonId ? await loadTeamReport(supabase, team.teamId, seasonId, period) : null;
  const teamObjectives =
    team && seasonId ? await loadTeamObjectives(supabase, team.teamId, seasonId) : [];
  const playerObjectives =
    seasonId ? await loadPlayerObjectives(supabase, playerId, seasonId) : [];
  const stats = await loadFichaStats(supabase, playerId, selectedLabel, team?.teamId ?? null);
  const evolution = seasonId ? await loadPlayerEvolution(supabase, playerId, seasonId) : [];
  const teamEvolution =
    team && seasonId ? await loadTeamEvolution(supabase, team.teamId, seasonId) : [];

  const primaryPos = (PLAYER_POSITIONS as readonly string[]).includes(player.position_main ?? '')
    ? (player.position_main as PlayerPosition)
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_reports')}</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {report ? (
            <PublishToggle
              reportId={report.id}
              playerId={playerId}
              period={period}
              locale={locale}
              initialVisibility={report.visibility}
            />
          ) : null}
          {report ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/${locale}/jugadores/${playerId}/informes/${period}/pdf${seasonQs}`}>
                <Download className="size-4" aria-hidden />
                <span>{t('download_pdf')}</span>
              </a>
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={editHref}>
              <Pencil className="size-4" aria-hidden />
              <span>{t('edit_report')}</span>
            </Link>
          </Button>
        </div>
      </div>

      {!team || !seasonId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team_for_season')}
          </CardContent>
        </Card>
      ) : (
        <ReportFichaView
          data={{
            fullName,
            initials: (player.first_name[0] ?? '') + (player.last_name?.[0] ?? ''),
            photoUrl,
            dorsal: player.dorsal,
            age: ageFromDob(player.date_of_birth),
            primaryPos,
            secondaryPos: (player.positions_secondary ?? []) as string[],
            foot: player.foot,
            teamName: team.teamName,
            seasonLabel: selectedLabel,
            period,
            stats,
            scores: report?.scores ?? {},
            commentOverall: report?.comment_overall ?? null,
            teamReport: teamReport
              ? { scores: teamReport.scores, comment: teamReport.comment }
              : null,
            playerObjectives,
            teamObjectives,
            evolution,
            teamEvolution,
          }}
        />
      )}
    </div>
  );
}
