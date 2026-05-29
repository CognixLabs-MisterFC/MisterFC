import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarDays, Users } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AttendanceMarker } from './_components/attendance-marker';
import { loadEventAttendance } from '../queries';
import type { Role } from '../../jugadores/queries';

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

const ALLOWED: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
];

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(d);
}

function initials(first: string, last: string): string {
  const a = first.trim().charAt(0).toUpperCase();
  const b = last.trim().charAt(0).toUpperCase();
  return `${b || a}${a || ''}`.slice(0, 2);
}

export default async function AttendanceMarkingPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED.includes(role)) redirect(`/${locale}`);

  const data = await loadEventAttendance(
    ctx.activeClub.club.id,
    role,
    eventId
  );
  if (!data) notFound();

  const t = await getTranslations('asistencia');
  const tCodes = await getTranslations('asistencia.codes');

  const { event, roster, attendance, canRecord, isFuture } = data;
  const markedCount = roster.filter((p) => attendance.has(p.id)).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/asistencia">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('detail.back')}</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            <span>{fmtDate(event.starts_at, locale)}</span>
          </div>
          <CardTitle className="text-2xl">{event.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card/30 px-2 py-0.5 text-xs"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: event.team_color,
              }}
            >
              {event.team_name}
            </span>
            <span>·</span>
            <span>
              {event.category_name} · {event.category_season}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden />
            <span>
              {t('detail.progress', {
                marked: markedCount,
                total: roster.length,
              })}
            </span>
          </div>
          {isFuture && (
            <Badge variant="secondary">{t('detail.future_event')}</Badge>
          )}
        </CardContent>
      </Card>

      {roster.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('detail.empty_roster')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('detail.roster_title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {roster.map((p) => {
                const att = attendance.get(p.id) ?? null;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        aria-hidden
                      >
                        {initials(p.first_name, p.last_name)}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {p.last_name}, {p.first_name}
                        </span>
                        {p.dorsal != null && (
                          <span className="text-xs text-muted-foreground">
                            #{p.dorsal}
                          </span>
                        )}
                        {att && (
                          <span className="text-[10px] text-muted-foreground/80">
                            {tCodes(att.code)}
                            {att.notes && (
                              <>
                                {' · '}
                                <span className="italic">{att.notes}</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <AttendanceMarker
                      eventId={event.id}
                      playerId={p.id}
                      current={att?.code ?? null}
                      disabled={!canRecord || isFuture}
                    />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {!canRecord && (
        <p className="text-xs text-muted-foreground">
          {t('detail.read_only')}
        </p>
      )}
    </div>
  );
}
