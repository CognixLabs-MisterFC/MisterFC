import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarClock, TriangleAlert } from 'lucide-react';
import {
  createSupabaseServerClient,
  formatPlayerName,
  seasonEndDate,
  currentSeason,
} from '@misterfc/core';
import { Link } from '@/i18n/navigation';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FinalizeForm } from './finalize-form';

type Props = { params: Promise<{ locale: string }> };

type TeamRow = { id: string; season: string };
type MemberRow = {
  team_id: string;
  player_id: string;
  players: { first_name: string; last_name: string | null };
};

export default async function FinalizarPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'admin_club') redirect(`/${locale}/equipos`);

  const t = await getTranslations('equipos');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  const { data: upcomingRow } = await supabase
    .from('seasons')
    .select('label')
    .eq('club_id', clubId)
    .eq('status', 'upcoming')
    .maybeSingle();
  const upcomingSeason = (upcomingRow?.label as string | undefined) ?? null;

  // Pre-chequeo: jugadores en un equipo de la activa pero NO colocados en ningún
  // equipo de la upcoming (se quedarían sin equipo). Solo si hay upcoming.
  const unplaced: { id: string; name: string }[] = [];
  if (upcomingSeason) {
    const { data: teamsData } = await supabase
      .from('teams')
      .select('id, season')
      .eq('club_id', clubId)
      .in('season', [activeSeason, upcomingSeason]);
    const teams = (teamsData ?? []) as unknown as TeamRow[];
    const activeTeamIds = teams.filter((tm) => tm.season === activeSeason).map((tm) => tm.id);
    const upcomingTeamIds = new Set(
      teams.filter((tm) => tm.season === upcomingSeason).map((tm) => tm.id),
    );
    const allIds = teams.map((tm) => tm.id);

    const { data: memberData } = allIds.length
      ? await supabase
          .from('team_members')
          .select('team_id, player_id, players!inner(first_name, last_name)')
          .in('team_id', allIds)
          .is('left_at', null)
      : { data: [] as MemberRow[] };
    const members = (memberData ?? []) as unknown as MemberRow[];

    const placedInUpcoming = new Set(
      members.filter((m) => upcomingTeamIds.has(m.team_id)).map((m) => m.player_id),
    );
    const activeSet = new Set(activeTeamIds);
    const seen = new Set<string>();
    for (const m of members) {
      if (!activeSet.has(m.team_id)) continue;
      if (placedInUpcoming.has(m.player_id) || seen.has(m.player_id)) continue;
      seen.add(m.player_id);
      unplaced.push({
        id: m.player_id,
        name: formatPlayerName(m.players.first_name, m.players.last_name),
      });
    }
    unplaced.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  const defaultCutoff = seasonEndDate(activeSeason) ?? `${currentSeason().slice(0, 4)}-07-31`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href="/equipos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('finalize.back')}</span>
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{t('finalize.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finalize.subtitle')}</p>
      </div>

      {!upcomingSeason ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('finalize.no_upcoming')}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/equipos">{t('finalize.back')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-2 py-4 text-sm">
              <p>{t('finalize.summary', { active: activeSeason, upcoming: upcomingSeason })}</p>
              <ul className="ml-4 list-disc text-muted-foreground">
                <li>{t('finalize.step_close', { active: activeSeason })}</li>
                <li>{t('finalize.step_activate', { upcoming: upcomingSeason })}</li>
              </ul>
            </CardContent>
          </Card>

          {unplaced.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="flex flex-col gap-2 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="size-4" aria-hidden />
                  {t('finalize.unplaced_title', { count: unplaced.length })}
                </div>
                <p className="text-xs text-muted-foreground">{t('finalize.unplaced_hint')}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {unplaced.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-amber-500/40 bg-background px-2 py-0.5 text-xs"
                    >
                      {p.name}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <FinalizeForm
            activeSeason={activeSeason}
            upcomingSeason={upcomingSeason}
            defaultCutoff={defaultCutoff}
            unplacedCount={unplaced.length}
          />
        </>
      )}
    </div>
  );
}
