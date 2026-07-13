/**
 * F14E-6 — "Plantilla" del jugador (SOLO-LECTURA): roster de su(s) equipo(s) con
 * identidad deportiva + stats agregadas por compañero. Entra desde la card
 * "Compañeros" de /mi-equipo. Guard jugador (molde /mi-equipo/*). Sin acciones de
 * edición. Selector de equipo si el jugador está en varios.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Users } from 'lucide-react';
import {
  createSupabaseServerClient,
  formatPlayerName,
  teamsInActiveSeason,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TeamSelectorWrapper } from '../team-selector-wrapper';
import { loadTeamRosterStats } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ team?: string }>;
};

const KNOWN_POSITIONS = new Set([
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
]);
const KNOWN_FEET = new Set(['right', 'left', 'both']);

export default async function PlantillaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_plantilla');
  const tCol = await getTranslations('equipo_stats.col');
  const tJug = await getTranslations('jugadores');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Players vinculados al user en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id)')
    .eq('profile_id', ctx.user.id);
  type PA = { player_id: string; players: { id: string; club_id: string } };
  const myPlayerIds = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === ctx.activeClub.club.id)
    .map((p) => p.player_id);

  // Teams del jugador (temporada activa) con nombre de categoría (selector).
  type TM = {
    team_id: string;
    teams: {
      id: string;
      name: string;
      season: string;
      category_id: string;
      categories: { name: string };
    };
  };
  let teams: Array<{ id: string; name: string; category_name: string }> = [];
  if (myPlayerIds.length > 0) {
    const { data: tmRows } = await supabase
      .from('team_members')
      .select(
        'team_id, teams!inner(id, name, season, category_id, categories!inner(name))',
      )
      .in('player_id', myPlayerIds)
      .is('left_at', null);
    const activeSeason = await getActiveSeasonLabel(
      supabase,
      ctx.activeClub.club.id,
    );
    teams = teamsInActiveSeason(
      ((tmRows ?? []) as unknown as TM[]).map((r) => ({
        ...r,
        season: r.teams.season,
      })),
      activeSeason,
    ).map((r) => ({
      id: r.teams.id,
      name: r.teams.name,
      category_name: r.teams.categories.name,
    }));
  }

  if (teams.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <BackLink label={t('back')} />
        <div className="flex items-center gap-3">
          <Users className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeTeam =
    teams.find((tm) => tm.id === sp.team) ?? teams[0]!;
  const roster = await loadTeamRosterStats(activeTeam.id);

  const positionLabel = (pos: string | null) =>
    pos && KNOWN_POSITIONS.has(pos) ? tJug(`positions.${pos}`) : '—';
  const footLabel = (foot: string | null) =>
    foot && KNOWN_FEET.has(foot) ? tJug(`foot.${foot}`) : '—';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink label={t('back')} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Users className="size-6" aria-hidden />
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">
              {activeTeam.name} · {activeTeam.category_name}
            </p>
          </div>
        </div>
        {teams.length > 1 && (
          <TeamSelectorWrapper
            locale={locale}
            activeTeamId={activeTeam.id}
            teams={teams}
            basePath="/mi-equipo/plantilla"
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('subtitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {roster.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tCol('dorsal')}</TableHead>
                    <TableHead>{tCol('player')}</TableHead>
                    <TableHead>{t('col.position')}</TableHead>
                    <TableHead>{t('col.foot')}</TableHead>
                    <TableHead className="text-right">{tCol('matches')}</TableHead>
                    <TableHead className="text-right">{tCol('starts')}</TableHead>
                    <TableHead className="text-right">{tCol('minutes')}</TableHead>
                    <TableHead className="text-right">{tCol('goals')}</TableHead>
                    <TableHead className="text-right">{tCol('assists')}</TableHead>
                    <TableHead className="text-right">{tCol('yellow')}</TableHead>
                    <TableHead className="text-right">{tCol('red')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((p) => (
                    <TableRow key={p.player_id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {p.dorsal != null ? `#${p.dorsal}` : '—'}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatPlayerName(p.first_name, p.last_name)}
                      </TableCell>
                      <TableCell>{positionLabel(p.position)}</TableCell>
                      <TableCell>{footLabel(p.foot)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.matches}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.starts}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.minutesPlayed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.goals}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.assists}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.yellowCards}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.stats.redCards}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <Link href="/mi-equipo">
        <ArrowLeft className="size-4" aria-hidden />
        <span>{label}</span>
      </Link>
    </Button>
  );
}
