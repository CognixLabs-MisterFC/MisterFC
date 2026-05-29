import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarOff, Megaphone, Trophy } from 'lucide-react';
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
import { loadUpcomingCallups } from './queries';
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
  const items = await loadUpcomingCallups(
    ctx.activeClub.club.id,
    role,
    30
  );

  const isPlayerView = role === 'jugador';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
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
          {items.map((m) => {
            const responded = m.responses_count.yes +
              m.responses_count.maybe +
              m.responses_count.no;
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
                        style={{
                          borderLeftWidth: 3,
                          borderLeftColor: m.team_color,
                        }}
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
                        <span className="font-medium">
                          {tResponse(m.my_response)}
                        </span>
                      </p>
                    ) : m.published ? (
                      <p className="text-xs text-muted-foreground">
                        {t('your_response_pending')}
                      </p>
                    ) : null
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">
                        {t('count_responded', {
                          n: responded,
                          total: m.roster_count,
                        })}
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
                        {t('count_called_up', {
                          n: m.decisions_count.called_up,
                        })}
                      </Badge>
                    </div>
                  )}

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
          })}
        </div>
      )}
    </div>
  );
}
