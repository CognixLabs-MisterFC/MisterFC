import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardList, Download } from 'lucide-react';
import {
  createSupabaseServerClient,
  getPlayerReportBundleFromClient,
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
 * F13.10d — Informe de desarrollo, vista jugador/familia (read-only).
 *
 * O2-5 C1 — la orquestación (temporadas, periodos publicados, ensamblado del
 * informe) vive en core (`getPlayerReportBundleFromClient`); esta página lo
 * consume, firma la foto (Storage server-only) y lo pinta con `ReportFichaView`.
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

  // 2) Jugador activo + informe (temporadas/periodos/ensamblado en core).
  const activePlayer = myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0]!;
  const playerId = activePlayer.id;

  const bundle = await getPlayerReportBundleFromClient(supabase, clubId, playerId, {
    season: seasonParam,
    period: informeParam,
  });
  const { seasons, activeSeason, periods: devReportPeriods } = bundle;

  let devFicha: ReportFichaData | null = null;
  if (bundle.report) {
    const rep = bundle.report;
    let photoUrl: string | null = null;
    if (rep.identity.photoPath) {
      const { data: signed } = await supabase.storage
        .from('player-photos')
        .createSignedUrl(rep.identity.photoPath, PHOTO_TTL);
      photoUrl = signed?.signedUrl ?? null;
    }
    const primaryPos = (PLAYER_POSITIONS as readonly string[]).includes(
      rep.identity.positionMain ?? '',
    )
      ? (rep.identity.positionMain as PlayerPosition)
      : null;
    devFicha = {
      fullName: activePlayer.name,
      initials:
        (rep.identity.firstName?.[0] ?? '') + (rep.identity.lastName?.[0] ?? ''),
      photoUrl,
      dorsal: rep.identity.dorsal,
      age: ageFromDob(rep.identity.dateOfBirth),
      primaryPos,
      secondaryPos: rep.identity.positionsSecondary,
      foot: rep.identity.foot,
      teamName: rep.teamName,
      seasonLabel: activeSeason ?? '',
      period: rep.period,
      stats: rep.fichaStats,
      scores: rep.scores,
      commentOverall: rep.commentOverall,
      teamReport: rep.teamReport,
      playerObjectives: rep.playerObjectives,
      teamObjectives: rep.teamObjectives,
      evolution: rep.evolution,
      teamEvolution: rep.teamEvolution,
    };
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
