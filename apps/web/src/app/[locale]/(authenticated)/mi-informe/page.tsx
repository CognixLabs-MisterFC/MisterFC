import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardList, Download } from 'lucide-react';
import {
  createSupabaseServerClient,
  DEVELOPMENT_PERIODS,
  PLAYER_POSITIONS,
  type PlayerPosition,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ReportFichaView,
  type ReportFichaData,
} from '../jugadores/[playerId]/informes/_components/report-ficha-view';
import {
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadPlayerEvolution,
} from '../jugadores/[playerId]/informes/queries';
import { PlayerSelector } from '../mi-ficha/player-selector';
import { ReportPeriodSelect } from './report-period-select';
import { SeasonSelect } from './season-select';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string; season?: string; informe?: string }>;
};

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

/**
 * F13.10d — Informe de desarrollo, vista jugador/familia (ruta propia, enlazada
 * desde el menú lateral solo para el rol `jugador`). Muestra los informes
 * PUBLICADOS (visibility='team'; la RLS de PR1 ya recorta a SOLO los del propio
 * jugador) en read-only, reusando la ficha rediseñada (`ReportFichaView`).
 *
 * Selectores de jugador (cuenta familiar con varios), temporada y periodo. El
 * staff NO ve este enlace: accede por la ficha del equipo / mis-equipos.
 */
export default async function MiInformePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const {
    player: playerParam,
    season: seasonParam,
    informe: informeParam,
  } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo jugador/familia. El staff accede por la ficha del equipo / mis-equipos.
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_informe');
  const tInf = await getTranslations('informes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // 1) Jugadores vinculados a la cuenta (vía player_accounts) en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id, first_name, last_name)')
    .eq('profile_id', ctx.user.id);
  type PA = {
    player_id: string;
    players: {
      id: string;
      club_id: string;
      first_name: string;
      last_name: string | null;
    };
  };
  const myPlayers = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === clubId)
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
    }));

  const header = (
    <div className="flex items-center gap-3">
      <ClipboardList className="size-6" aria-hidden />
      <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
    </div>
  );

  if (myPlayers.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_player')}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2) Jugador activo + temporadas de su trayectoria (selector + default).
  const activePlayer = myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0]!;
  const playerId = activePlayer.id;

  const { data: history } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(season)')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  type HistTeam = { season: string } | null;
  const seasonsSet = new Set<string>();
  let activeSeasonFromHistory: string | null = null;
  for (const h of history ?? []) {
    const tm = (h.teams ?? null) as HistTeam;
    const s = tm?.season;
    if (s) {
      seasonsSet.add(s);
      if (h.left_at === null) activeSeasonFromHistory = s;
    }
  }
  const seasons = Array.from(seasonsSet).sort((a, b) => b.localeCompare(a));
  const activeSeason =
    (seasonParam && seasons.includes(seasonParam) ? seasonParam : null) ??
    activeSeasonFromHistory ??
    seasons[0] ??
    null;

  // 3) Informes PUBLICADOS del jugador en la temporada (RLS de PR1 → solo suyos).
  let devReportPeriods: string[] = [];
  let devFicha: ReportFichaData | null = null;
  if (activeSeason) {
    const { data: seasonRow } = await supabase
      .from('seasons')
      .select('id')
      .eq('club_id', clubId)
      .eq('label', activeSeason)
      .maybeSingle();
    const seasonId = (seasonRow?.id as string | undefined) ?? null;
    if (seasonId) {
      const { data: pubRows } = await supabase
        .from('development_reports')
        .select('period')
        .eq('player_id', playerId)
        .eq('season_id', seasonId);
      const pubSet = new Set((pubRows ?? []).map((r) => r.period as string));
      devReportPeriods = DEVELOPMENT_PERIODS.filter((p) => pubSet.has(p));
      const selPeriod =
        informeParam && devReportPeriods.includes(informeParam)
          ? informeParam
          : devReportPeriods[0];
      if (selPeriod) {
        const { data: pl } = await supabase
          .from('players')
          .select(
            'first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url'
          )
          .eq('id', playerId)
          .maybeSingle();
        const team = await resolvePlayerTeamForSeason(supabase, playerId, activeSeason);
        const [report, playerObjectives, teamObjectives, stats, evolution] =
          await Promise.all([
            loadIndividualReport(supabase, playerId, seasonId, selPeriod),
            loadPlayerObjectives(supabase, playerId, seasonId),
            team ? loadTeamObjectives(supabase, team.teamId, seasonId) : Promise.resolve([]),
            loadFichaStats(supabase, playerId, activeSeason),
            loadPlayerEvolution(supabase, playerId, seasonId),
          ]);
        // Bloque de equipo: por el id enlazado (la RLS helper de PR1 lo permite).
        let teamReport: { scores: Record<string, number>; comment: string | null } | null =
          null;
        if (report?.team_report_id) {
          const { data: tr } = await supabase
            .from('team_development_reports')
            .select('scores, comment')
            .eq('id', report.team_report_id)
            .maybeSingle();
          if (tr) {
            teamReport = {
              scores: (tr.scores as Record<string, number>) ?? {},
              comment: (tr.comment as string | null) ?? null,
            };
          }
        }
        let photoUrl: string | null = null;
        if (pl?.photo_url) {
          const { data: signed } = await supabase.storage
            .from('player-photos')
            .createSignedUrl(pl.photo_url, PHOTO_TTL);
          photoUrl = signed?.signedUrl ?? null;
        }
        const primaryPos = (PLAYER_POSITIONS as readonly string[]).includes(
          pl?.position_main ?? ''
        )
          ? (pl!.position_main as PlayerPosition)
          : null;
        devFicha = {
          fullName: activePlayer.name,
          initials: (pl?.first_name?.[0] ?? '') + (pl?.last_name?.[0] ?? ''),
          photoUrl,
          dorsal: pl?.dorsal ?? null,
          age: ageFromDob(pl?.date_of_birth ?? null),
          primaryPos,
          secondaryPos: (pl?.positions_secondary ?? []) as string[],
          foot: pl?.foot ?? null,
          teamName: team?.teamName ?? '',
          seasonLabel: activeSeason,
          period: selPeriod,
          stats,
          scores: report?.scores ?? {},
          commentOverall: report?.comment_overall ?? null,
          teamReport,
          playerObjectives,
          teamObjectives,
          evolution,
        };
      }
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {header}

      {myPlayers.length > 1 && (
        <PlayerSelector
          locale={locale}
          activePlayerId={playerId}
          players={myPlayers}
          basePath="/mi-informe"
        />
      )}

      <div className="flex flex-wrap items-center gap-4">
        {seasons.length > 1 && activeSeason && (
          <SeasonSelect seasons={seasons} current={activeSeason} />
        )}
        {devReportPeriods.length > 1 && devFicha && (
          <ReportPeriodSelect periods={devReportPeriods} current={devFicha.period} />
        )}
        {devFicha && (
          <Button asChild variant="outline" size="sm" className="ml-auto gap-2">
            <a
              href={`/${locale}/jugadores/${playerId}/informes/${devFicha.period}/pdf?season=${encodeURIComponent(devFicha.seasonLabel)}`}
            >
              <Download className="size-4" aria-hidden />
              <span>{tInf('download_pdf')}</span>
            </a>
          </Button>
        )}
      </div>

      {devFicha ? (
        <ReportFichaView data={devFicha} />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_reports')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
