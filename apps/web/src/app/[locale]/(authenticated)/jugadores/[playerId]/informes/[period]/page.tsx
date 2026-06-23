/**
 * F13.10b-1 — Editor de un Informe de desarrollo (un periodo) de un jugador.
 * Gate D13. Resuelve temporada (default activa) + equipo del jugador en esa
 * temporada y carga el informe existente (si lo hay) para precargar el formulario.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DevelopmentReportForm } from '../_components/development-report-form';
import { loadClubSeasons, resolvePlayerTeamForSeason, loadReportsByPeriod } from '../queries';

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
  const season = seasons.find((s) => s.label === selectedLabel) ?? null;
  const team = await resolvePlayerTeamForSeason(supabase, playerId, selectedLabel);

  const backHref = `/jugadores/${playerId}/informes?season=${encodeURIComponent(selectedLabel)}`;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  // Sin temporada en la tabla canónica o sin equipo esa temporada → no editable.
  if (!season?.id || !team) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_reports')}</span>
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team_for_season')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const reports = await loadReportsByPeriod(supabase, playerId, season.id);
  const existing = reports.get(period) ?? null;

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
          {t(`period.${period}`)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fullName} · {team.teamName} · {selectedLabel}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DevelopmentReportForm
            playerId={playerId}
            teamId={team.teamId}
            seasonId={season.id}
            period={period}
            initial={
              existing
                ? {
                    score_tecnica_tactica: existing.score_tecnica_tactica,
                    score_fisica: existing.score_fisica,
                    score_psicologica: existing.score_psicologica,
                    score_social: existing.score_social,
                    comment_tecnica_tactica: existing.comment_tecnica_tactica,
                    comment_fisica: existing.comment_fisica,
                    comment_psicologica: existing.comment_psicologica,
                    comment_social: existing.comment_social,
                    comment_overall: existing.comment_overall,
                  }
                : null
            }
            canEdit
          />
        </CardContent>
      </Card>
    </div>
  );
}
