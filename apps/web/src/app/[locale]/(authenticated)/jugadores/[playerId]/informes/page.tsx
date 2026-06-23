/**
 * F13.10b-1 — Listado de Informes de desarrollo de un jugador (zona staff):
 * selector de temporada + rejilla de los 4 periodos con su estado (puntuado o sin
 * informe) y enlace al editor. Gate D13 (admin/coord + principal + ayudante).
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import {
  createSupabaseServerClient,
  DEVELOPMENT_PERIODS,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SeasonSelect } from './_components/season-select';
import { ObjectivesSection } from './_components/objectives-section';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadReportsByPeriod,
  loadPlayerObjectives,
  loadTeamObjectives,
} from './queries';

type Props = {
  params: Promise<{ locale: string; playerId: string }>;
  searchParams: Promise<{ season?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function InformesListPage({ params, searchParams }: Props) {
  const { locale, playerId } = await params;
  const { season: seasonParam } = await searchParams;
  setRequestLocale(locale);

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
  // Si la activa no está en la tabla seasons, la añadimos como opción.
  const seasonOptions = seasons.some((s) => s.label === activeLabel)
    ? seasons
    : [{ id: '', label: activeLabel, status: 'active' }, ...seasons];
  const selectedLabel =
    seasonParam && seasonOptions.some((s) => s.label === seasonParam)
      ? seasonParam
      : activeLabel;
  const selectedSeason = seasonOptions.find((s) => s.label === selectedLabel) ?? null;

  const team = await resolvePlayerTeamForSeason(supabase, playerId, selectedLabel);
  const seasonId = selectedSeason?.id ?? null;
  const reports = seasonId ? await loadReportsByPeriod(supabase, playerId, seasonId) : new Map();
  const playerObjectives =
    seasonId ? await loadPlayerObjectives(supabase, playerId, seasonId) : [];
  const teamObjectives =
    team && seasonId ? await loadTeamObjectives(supabase, team.teamId, seasonId) : [];

  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();
  const canEdit = !team || !selectedSeason?.id ? false : true;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/jugadores/${playerId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_player')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fullName}
            {team ? ` · ${team.teamName}` : ''}
          </p>
        </div>
        <SeasonSelect seasons={seasonOptions} current={selectedLabel} label={t('season')} />
      </div>

      {!team ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team_for_season')}
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DEVELOPMENT_PERIODS.map((period) => {
            const r = reports.get(period);
            return (
              <Card key={period}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base">{t(`period.${period}`)}</CardTitle>
                  {r?.visibility === 'team' ? (
                    <span className="rounded-full bg-misterfc-green/15 px-2 py-0.5 text-xs text-misterfc-green">
                      {t('shared')}
                    </span>
                  ) : r ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t('draft')}
                    </span>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p className="text-muted-foreground">
                    {r ? t('has_report') : t('no_report')}
                  </p>
                  {canEdit ? (
                    <Button asChild variant={r ? 'outline' : 'default'} size="sm" className="self-start">
                      <Link href={`/jugadores/${playerId}/informes/${period}?season=${encodeURIComponent(selectedLabel)}`}>
                        {r ? t('edit') : t('create')}
                      </Link>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {seasonId ? (
          <>
            <ObjectivesSection
              kind="player"
              items={playerObjectives}
              playerId={playerId}
              teamId={team.teamId}
              seasonId={seasonId}
            />
            <ObjectivesSection
              kind="team"
              items={teamObjectives}
              playerId={playerId}
              teamId={team.teamId}
              seasonId={seasonId}
            />
          </>
        ) : null}
        </>
      )}
    </div>
  );
}
