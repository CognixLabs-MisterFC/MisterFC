import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { MatchTeamStats } from '@misterfc/core';
import { MatchTimeline } from '@/components/match/match-timeline';
import { loadMatchStats } from './queries';
import { PlayerStatsTable } from './_components/player-stats-table';
import type { Role } from '../../../jugadores/queries';

// Vista de consulta; se hidrata del estado real (stats consolidadas) al entrar.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

function fmtDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function MatchStatsPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  const result = await loadMatchStats(
    ctx.activeClub.club.id,
    eventId,
    ctx.user.id,
    role,
  );

  if (result.status === 'not_found') notFound();
  // Partido no cerrado (staff) o sin permiso → de vuelta al detalle.
  if (result.status === 'not_closed' || result.status === 'forbidden') {
    redirect(`/${locale}/convocatorias/${eventId}`);
  }

  const t = await getTranslations('estadisticas_partido');

  const BackBar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/convocatorias/${eventId}`}>
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t('back')}</span>
        </Link>
      </Button>
    </div>
  );

  // Familia sin stats de su hijo (no participó / no cerrado).
  if (result.status === 'empty') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {BackBar}
        <header>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </header>
        <p className="text-sm text-muted-foreground">{t('empty_family')}</p>
      </div>
    );
  }

  const { view } = result;
  const { event } = view;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {BackBar}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {event.title}
          {event.opponentName ? ` · vs ${event.opponentName}` : ''}
          {' · '}
          {event.teamName} · {fmtDate(event.startsAt, locale)}
        </p>
        {view.viewer === 'staff' &&
          (view.score.own != null || view.score.against != null) && (
            <p className="text-3xl font-bold tabular-nums">
              {view.score.own ?? 0}
              <span className="mx-2 text-muted-foreground">–</span>
              {view.score.against ?? 0}
            </p>
          )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {view.viewer === 'family'
              ? t('section_my_player')
              : t('section_players')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerStatsTable players={view.players} />
          {view.viewer === 'family' && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('family_note')}
            </p>
          )}
        </CardContent>
      </Card>

      {view.viewer === 'staff' && <TeamPanel team={view.team} />}

      {view.viewer === 'staff' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('timeline_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MatchTimeline entries={view.timeline} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function TeamPanel({ team }: { team: MatchTeamStats }) {
  const t = await getTranslations('estadisticas_partido');
  const rows: { key: keyof MatchTeamStats; label: string }[] = [
    { key: 'corners', label: 'team.corners' },
    { key: 'fouls', label: 'team.fouls' },
    { key: 'shots', label: 'team.shots' },
    { key: 'yellowCards', label: 'team.yellow' },
    { key: 'redCards', label: 'team.red' },
    { key: 'offsides', label: 'team.offsides' },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('team.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground" />
          <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('team.us')}
          </span>
          <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('team.them')}
          </span>
          {rows.map((r) => (
            <Row key={r.key} label={t(r.label)} pair={team[r.key]} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  pair,
}: {
  label: string;
  pair: { own: number; rival: number };
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold tabular-nums">{pair.own}</span>
      <span className="text-right font-semibold tabular-nums text-muted-foreground">
        {pair.rival}
      </span>
    </>
  );
}
