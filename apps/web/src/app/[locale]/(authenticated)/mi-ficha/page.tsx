import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Download, LineChart } from 'lucide-react';
import {
  createSupabaseServerClient,
  getPlayerFichaFromClient,
  PLAYER_POSITIONS,
  type PlayerPosition,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadPlayerBadges } from '@/lib/player-badges';
import { loadShellContext } from '@/lib/auth-shell';
import { loadAccountPlayers } from '@/lib/account-players';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlayerSeasonStats } from '../jugadores/[playerId]/player-season-stats';
import { PlayerBadges } from '../jugadores/[playerId]/player-badges';
import { FichaHeader } from '../jugadores/[playerId]/informes/_components/ficha-header';
import { PlayerSelector } from './player-selector';
import { PlayerEvaluationsDetail } from './player-evaluations-detail';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string; season?: string }>;
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
 * F9.5 — Vista jugador/familia del expediente deportivo (`/mi-ficha`).
 *
 * O2-5 C1 — el fetch + cálculo del expediente (identidad, temporadas, stats,
 * ratios, asistencia, evolución, valoraciones, carrera) vive en core
 * (`getPlayerFichaFromClient`); esta página lo consume, firma la foto (Storage
 * server-only) y ensambla las badges (dependen del roster del equipo). La gestión
 * por-player (foto, médica, expediente, olvido) vive en /perfil; /mi-ficha es solo
 * consulta deportiva.
 */
export default async function MiFichaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { player: playerParam, season: seasonParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo jugador/familia (comparten el rol `jugador`). El staff usa /jugadores.
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_ficha');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Jugadores vinculados a la cuenta (vía player_accounts) en el club activo.
  const myPlayers = await loadAccountPlayers(
    supabase,
    ctx.user.id,
    ctx.activeClub.club.id,
  );

  if (myPlayers.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <LineChart className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_player')}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2) Jugador activo: query param o el primero. (length > 0 garantizado.)
  const activePlayer =
    myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0]!;
  const playerId = activePlayer.id;

  // 3) Expediente deportivo completo (fetch + cálculo en core).
  const ficha = await getPlayerFichaFromClient(supabase, playerId, {
    season: seasonParam,
  });
  const { identity } = ficha;

  // Foto firmada para la cabecera (Storage, server-only). La familia solo ve la de
  // su jugador (RLS); la gestión de la foto vive en /perfil.
  let headerPhotoUrl: string | null = null;
  if (identity.photoPath) {
    const { data: signed } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(identity.photoPath, PHOTO_TTL);
    headerPhotoUrl = signed?.signedUrl ?? null;
  }
  const headerPrimaryPos = (PLAYER_POSITIONS as readonly string[]).includes(
    identity.positionMain ?? '',
  )
    ? (identity.positionMain as PlayerPosition)
    : null;

  // 4) Badges (logros): dependen del roster del equipo (loadTeamSeasonStats), no
  //    del fetch de ficha. showRating se computa en servidor desde club_settings.
  const badges = await loadPlayerBadges(supabase, {
    playerId,
    clubId: ctx.activeClub.club.id,
    careerMatches: ficha.career.totals.stats.matches,
  });
  const tBadges = await getTranslations('badges');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <LineChart className="size-6" aria-hidden />
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {myPlayers.length > 1 ? t('subtitle_many') : t('subtitle_one')}
          </p>
        </div>
        {/* PDF del expediente (9.B-6): mismo Route Handler del jugador, RLS
            heredada (la familia solo ve lo de su jugador, sin médicas/notas). */}
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={`/${locale}/jugadores/${playerId}/pdf`}>
            <Download className="size-4" aria-hidden />
            <span>{t('export_pdf')}</span>
          </a>
        </Button>
      </div>

      {myPlayers.length > 1 && (
        <PlayerSelector
          locale={locale}
          activePlayerId={playerId}
          players={myPlayers}
        />
      )}

      {/* Cabecera de identidad (reusa la del informe de desarrollo). */}
      <Card>
        <CardContent className="pt-6">
          <FichaHeader
            data={{
              fullName: activePlayer.name,
              initials:
                (identity.firstName?.[0] ?? '') + (identity.lastName?.[0] ?? ''),
              photoUrl: headerPhotoUrl,
              dorsal: identity.dorsal,
              age: ageFromDob(identity.dateOfBirth),
              primaryPos: headerPrimaryPos,
              secondaryPos: identity.positionsSecondary,
              foot: identity.foot,
              subtitle: ficha.activeSeason,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('section.stats')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerSeasonStats
            stats={ficha.stats}
            statsByType={ficha.statsByType}
            ratios={ficha.ratios}
            attendance={ficha.attendance}
            timeline={ficha.evolution}
            seasons={ficha.seasons}
            activeSeason={ficha.activeSeason}
            career={ficha.career}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tBadges('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerBadges badges={badges} />
        </CardContent>
      </Card>

      {ficha.evaluations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('section.evaluations')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlayerEvaluationsDetail items={ficha.evaluations} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
