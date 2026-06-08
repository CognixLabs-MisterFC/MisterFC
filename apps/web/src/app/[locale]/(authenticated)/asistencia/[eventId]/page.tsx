import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarDays, Star, Users } from 'lucide-react';
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
import { AttendanceRow } from './_components/attendance-row';
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
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden />
            <span>
              {t('detail.progress', {
                marked: markedCount,
                total: roster.length,
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* F8.3 — valorar el entrenamiento (cuerpo técnico, evento ya
                celebrado). Flujo ligero, sin ciclo de partido. */}
            {canRecord && !isFuture && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/asistencia/${event.id}/valoracion`}>
                  <Star className="size-4" aria-hidden />
                  <span>{t('detail.rate_training')}</span>
                </Link>
              </Button>
            )}
            {isFuture && (
              <Badge variant="secondary">{t('detail.future_event')}</Badge>
            )}
          </div>
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
                  <AttendanceRow
                    key={p.id}
                    eventId={event.id}
                    playerId={p.id}
                    initialCode={att?.code ?? null}
                    initialNotes={att?.notes ?? null}
                    disabled={!canRecord || isFuture}
                    player={{
                      first_name: p.first_name,
                      last_name: p.last_name,
                      dorsal: p.dorsal,
                    }}
                  />
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
