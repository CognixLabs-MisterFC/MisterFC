/**
 * F13.10 (rework) — Editor de un periodo: PLACEHOLDER temporal "en reconstrucción".
 *
 * Tras el rework del modelo (4 corners → catálogos jsonb 1–10 + valoración de
 * equipo), el editor de puntuaciones se rehace de una pieza (equipo + individual)
 * en el siguiente paso. Aquí solo se mantiene la navegación y se avisa de que el
 * editor está en reconstrucción. Los OBJETIVOS siguen gestionándose en el listado.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Hammer } from 'lucide-react';
import { createSupabaseServerClient, isDevelopmentPeriod, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { loadClubSeasons, resolvePlayerTeamForSeason } from '../queries';

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
  const team = await resolvePlayerTeamForSeason(supabase, playerId, selectedLabel);

  const backHref = `/jugadores/${playerId}/informes?season=${encodeURIComponent(selectedLabel)}`;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

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
        <h1 className="text-2xl font-bold tracking-tight">{t(`period.${period}`)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fullName}
          {team ? ` · ${team.teamName}` : ''} · {selectedLabel}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Hammer className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{t('editor_rework_title')}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t('editor_rework_body')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
