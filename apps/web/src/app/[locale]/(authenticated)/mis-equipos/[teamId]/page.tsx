/**
 * /mis-equipos/[teamId] — Detalle de un equipo del coach.
 *
 * Contiene:
 *   - Plantilla del equipo (lo que mostraba /mi-plantilla).
 *   - Próximos eventos del equipo (training + match) con link al evento.
 *   - Sección "Acciones" contextual:
 *       · Convocar al próximo partido (si hay match futuro sin convocatoria).
 *       · Ver convocatorias activas del equipo (siempre disponible).
 *       · Marcar asistencia del último entrenamiento (si hay training reciente
 *         sin asistencia y el user puede marcarla).
 */

import { redirect, notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Megaphone,
  UserRound,
} from 'lucide-react';
import { PLAYER_POSITIONS } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadTeamDetail } from '../queries';
import { PositionFilter } from './position-filter';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
  searchParams: Promise<{ position?: string }>;
};

const STAFF_ROLES = ['entrenador_principal', 'entrenador_ayudante'] as const;

function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const mDiff = now.getUTCMonth() - d.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

export default async function TeamDetailPage({ params, searchParams }: Props) {
  const { locale, teamId } = await params;
  const { position: positionParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role;
  if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) {
    if (role === 'admin_club' || role === 'coordinador') {
      redirect(`/${locale}/jugadores`);
    }
    redirect(`/${locale}/perfil`);
  }

  const t = await getTranslations('mis_equipos');
  const tCat = await getTranslations('jugadores');

  const detail = await loadTeamDetail(
    ctx.activeClub.membershipId,
    ctx.activeClub.club.id,
    teamId
  );
  if (!detail) notFound();

  const positionFilter = PLAYER_POSITIONS.includes(
    positionParam as (typeof PLAYER_POSITIONS)[number]
  )
    ? (positionParam as (typeof PLAYER_POSITIONS)[number])
    : null;

  const filteredRoster = positionFilter
    ? detail.roster.filter(
        (r) => (r.position_in_team ?? r.position_main) === positionFilter
      )
    : detail.roster;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href="/mis-equipos">
              <ArrowLeft className="size-4" aria-hidden />
              <span>{t('back_to_hub')}</span>
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">
            {detail.team.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail.team.category_name} · {detail.team.category_season} ·{' '}
            {detail.team.format}
          </p>
        </div>
        <Badge variant="secondary" className="mt-2 shrink-0">
          {t(`staff_role.${detail.staff_role}`)}
        </Badge>
      </div>

      {/* Acciones contextuales — el entry point principal para F4 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('actions.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {detail.next_match_without_callup && (
            <Button asChild variant="default" size="sm">
              <Link
                href={`/convocatorias/${detail.next_match_without_callup.id}`}
              >
                <Megaphone className="size-4" aria-hidden />
                <span>
                  {t('actions.convocar_next', {
                    when: formatDateTime(
                      detail.next_match_without_callup.starts_at,
                      locale
                    ),
                  })}
                </span>
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/convocatorias?team=${detail.team.id}`}>
              <Megaphone className="size-4" aria-hidden />
              <span>
                {t('actions.view_active_callups', {
                  count: detail.callups_published_count,
                })}
              </span>
            </Link>
          </Button>
          {detail.last_training_without_attendance && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/asistencia/${detail.last_training_without_attendance.id}`}
              >
                <ClipboardCheck className="size-4" aria-hidden />
                <span>{t('actions.mark_last_attendance')}</span>
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/calendario?team=${detail.team.id}`}>
              <Calendar className="size-4" aria-hidden />
              <span>{t('actions.open_calendar')}</span>
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Próximos eventos */}
      {detail.upcoming_events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('upcoming.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-0">
            <ul className="flex flex-col divide-y divide-border">
              {detail.upcoming_events.slice(0, 5).map((ev) => {
                const isMatch = ev.type === 'match';
                const href = isMatch
                  ? `/convocatorias/${ev.id}`
                  : `/asistencia/${ev.id}`;
                return (
                  <li key={ev.id}>
                    <Link
                      href={href}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {isMatch && ev.opponent_name
                            ? t('upcoming.match_vs', {
                                opponent: ev.opponent_name,
                              })
                            : ev.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(ev.starts_at, locale)}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {isMatch && ev.has_callup_published && (
                          <Badge variant="default" className="text-xs">
                            {t('upcoming.callup_published')}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {t(`upcoming.type.${ev.type}`)}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Plantilla */}
      <PositionFilter currentPosition={positionFilter} />

      <Card>
        <CardHeader>
          <CardTitle>
            {t('roster.count', { count: filteredRoster.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-0">
          {filteredRoster.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <UserRound
                className="size-10 text-muted-foreground"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                {t('roster.empty')}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {filteredRoster.map((r) => {
                const position = r.position_in_team ?? r.position_main;
                const dorsal = r.dorsal_in_team ?? r.dorsal;
                return (
                  <li key={r.team_member_id}>
                    <Link
                      href={`/jugadores/${r.player_id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {r.last_name}, {r.first_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tCat('age_years', {
                            age: ageFromDob(r.date_of_birth),
                          })}
                          {position
                            ? ` · ${tCat(`positions.${position}`)}`
                            : ''}
                        </span>
                      </div>
                      {dorsal != null && (
                        <Badge variant="secondary">#{dorsal}</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Vacíos auxiliares */}
      {detail.upcoming_events.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <ClipboardList
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              {t('upcoming.empty')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
