import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CalendarOff,
  ClipboardList,
  Megaphone,
  Trophy,
} from 'lucide-react';
import { groupCallupsByTournament } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkNotificationsRead } from '@/components/notifications/mark-notifications-read';
import { loadUpcomingCallups, type CallupMatchRow } from './queries';
import type { Role } from '../jugadores/queries';

type Props = {
  params: Promise<{ locale: string }>;
};

const ALLOWED: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
];

function fmtDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

export default async function ConvocatoriasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('convocatorias');
  const tResponse = await getTranslations('convocatorias.response');
  const tTournament = await getTranslations('convocatorias.tournament');
  const items = await loadUpcomingCallups(
    ctx.activeClub.club.id,
    role,
    30
  );

  const isPlayerView = role === 'jugador';

  // F13B (T-5) — agrupa los sub-partidos bajo su torneo (cabecera + rondas) y
  // deja los partidos normales sueltos.
  const groups = groupCallupsByTournament(items);

  // Tarjeta de un partido SUELTO (match/friendly normal). La convocatoria y sus
  // contadores son los del propio evento.
  function renderMatchCard(m: CallupMatchRow) {
    return (
      <Card key={m.event_id}>
        <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Trophy className="size-3.5" aria-hidden />
              <span>{fmtDate(m.starts_at, locale)}</span>
            </div>
            <CardTitle className="text-base">
              {m.title}
              {m.opponent_name && (
                <span className="ml-1 text-muted-foreground">
                  · vs {m.opponent_name}
                </span>
              )}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-flex items-center rounded-md border border-border bg-card/30 px-2 py-0.5"
                style={{ borderLeftWidth: 3, borderLeftColor: m.team_color }}
              >
                {m.team_name}
              </span>
              <span>·</span>
              <span>
                {m.category_name} · {m.category_season}
              </span>
            </div>
          </div>
          <Badge variant={m.published ? 'default' : 'secondary'}>
            {m.published ? t('published') : t('draft')}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {renderCallupSummary(m)}
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/convocatorias/${m.event_id}`}>
                {isPlayerView ? t('open_player') : t('open_coach')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Bloque común: citación + respuesta (jugador) o contadores (entrenador).
  function renderCallupSummary(m: CallupMatchRow) {
    const responded =
      m.responses_count.yes + m.responses_count.maybe + m.responses_count.no;
    return (
      <>
        {m.published && m.meeting_at && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Megaphone className="size-3.5" aria-hidden />
            <span>
              {t('meeting_summary', {
                when: fmtDate(m.meeting_at, locale),
                where: m.meeting_location ?? '',
              })}
            </span>
          </p>
        )}
        {isPlayerView ? (
          m.my_response ? (
            <p className="text-xs">
              {t('your_response')}:{' '}
              <span className="font-medium">{tResponse(m.my_response)}</span>
            </p>
          ) : m.published ? (
            <p className="text-xs text-muted-foreground">
              {t('your_response_pending')}
            </p>
          ) : null
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">
              {t('count_responded', { n: responded, total: m.roster_count })}
            </Badge>
            <Badge variant="outline" className="border-emerald-500/40">
              {t('count_yes', { n: m.responses_count.yes })}
            </Badge>
            <Badge variant="outline" className="border-amber-500/40">
              {t('count_maybe', { n: m.responses_count.maybe })}
            </Badge>
            <Badge variant="outline" className="border-red-500/40">
              {t('count_no', { n: m.responses_count.no })}
            </Badge>
            <Badge variant="outline">
              {t('count_called_up', { n: m.decisions_count.called_up })}
            </Badge>
          </div>
        )}
      </>
    );
  }

  // F13B (T-5) — unidad de torneo: cabecera (convocatoria única) + rondas.
  function renderTournamentGroup(header: CallupMatchRow, matches: CallupMatchRow[]) {
    return (
      <Card key={header.event_id} className="border-primary/30">
        <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-primary" aria-hidden />
              {header.title}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-flex items-center rounded-md border border-border bg-card/30 px-2 py-0.5"
                style={{ borderLeftWidth: 3, borderLeftColor: header.team_color }}
              >
                {header.team_name}
              </span>
              <span>·</span>
              <span>
                {header.category_name} · {header.category_season}
              </span>
            </div>
          </div>
          <Badge variant={header.published ? 'default' : 'secondary'}>
            {header.published ? t('published') : t('draft')}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {renderCallupSummary(header)}

          <div className="rounded-md border border-border bg-card/30">
            <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              {tTournament('group_matches')}
            </p>
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {tTournament('group_no_matches')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {matches.map((sub) => (
                  <li
                    key={sub.event_id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {tTournament('group_round', { n: sub.round ?? 0 })}
                        {sub.opponent_name && (
                          <span className="ml-1 text-muted-foreground">
                            · vs {sub.opponent_name}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(sub.starts_at, locale)}
                      </span>
                    </div>
                    {!isPlayerView && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/convocatorias/${sub.event_id}/alineacion`}>
                          <ClipboardList className="size-4" aria-hidden />
                          <span>{tTournament('open_lineup')}</span>
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/convocatorias/${header.event_id}`}>
                {isPlayerView ? t('open_player') : t('open_coach')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <MarkNotificationsRead types={['callup_published', 'callup_updated']} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isPlayerView ? t('subtitle_player') : t('subtitle_coach')}
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarOff
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {groups.map((g) =>
            g.kind === 'tournament'
              ? renderTournamentGroup(g.header, g.matches)
              : renderMatchCard(g.match),
          )}
        </div>
      )}
    </div>
  );
}
