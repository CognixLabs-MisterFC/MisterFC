/**
 * F7.12 — Panel de "próximo partido" en Inicio (server component).
 *
 * - Cuerpo técnico (principal/ayudante): tarjeta del próximo partido + estado +
 *   botón al paso que toca (preparar convocatoria → esperar confirmación →
 *   alineación → en directo → postpartido).
 * - Jugador/familia: aviso si tiene convocatoria pendiente de confirmar.
 * - Admin/coord: no se muestra (el resumen global llega con F9).
 */

import { getTranslations } from 'next-intl/server';
import { CalendarClock, ClipboardCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Role } from './jugadores/queries';
import { resolveConvocatoriasScope } from './convocatorias/queries';
import {
  loadCoachNextMatch,
  loadPlayerPendingCallup,
  type CoachMatchState,
} from './next-match-queries';

const COACH_ROLES = new Set<Role>(['entrenador_principal', 'entrenador_ayudante']);

// CTA destino por estado. post_match no enlaza (F8 aún no existe).
function ctaHref(state: CoachMatchState, eventId: string): string | null {
  switch (state) {
    case 'prepare_callup':
    case 'awaiting_confirmations':
      return `/convocatorias/${eventId}`;
    case 'needs_lineup':
      return `/convocatorias/${eventId}/alineacion`;
    case 'ready':
      return `/convocatorias/${eventId}/directo`;
    case 'post_match':
      return null;
  }
}

function fmtDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

type Props = {
  role: Role;
  clubId: string;
  membershipId: string;
  locale: string;
};

export async function NextMatchPanel({
  role,
  clubId,
  membershipId,
  locale,
}: Props) {
  const t = await getTranslations('home.next_match');

  // Admin/coord: no panel (F9 trae el resumen global).
  if (role === 'admin_club' || role === 'coordinador') return null;

  // ── Jugador / familia ──
  if (role === 'jugador') {
    const scope = await resolveConvocatoriasScope(clubId, role);
    const playerIds = scope.kind === 'player' ? scope.playerIds : [];
    const pending = await loadPlayerPendingCallup(playerIds);
    if (!pending) return null;

    return (
      <Card className="border-misterfc-green/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4" aria-hidden />
            {t('player_pending.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t('player_pending.desc')}</p>
          <p className="font-medium">
            {pending.title}
            {pending.opponentName ? ` · vs ${pending.opponentName}` : ''}
            <span className="ml-1 font-normal text-muted-foreground">
              · {fmtDate(pending.startsAt, locale)}
            </span>
          </p>
          <Button asChild size="sm" className="self-start">
            <Link href={`/convocatorias/${pending.eventId}`}>
              {t('player_pending.cta')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Cuerpo técnico (principal / ayudante) ──
  if (!COACH_ROLES.has(role)) return null;

  const next = await loadCoachNextMatch(membershipId);
  if (!next) return null;

  const href = ctaHref(next.state, next.eventId);
  const stateLabel =
    next.state === 'awaiting_confirmations'
      ? t('state.awaiting_confirmations.label', {
          x: next.confirmed,
          y: next.calledUp,
        })
      : t(`state.${next.state}.label`);
  const ctaLabel = t(`state.${next.state}.cta`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <Badge variant={next.state === 'ready' ? 'default' : 'secondary'}>
          {stateLabel}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="font-medium">
          {next.title}
          {next.opponentName ? ` · vs ${next.opponentName}` : ''}
          <span className="ml-1 font-normal text-muted-foreground">
            · {next.teamName} · {fmtDate(next.startsAt, locale)}
          </span>
        </p>
        {href ? (
          <Button asChild size="sm" className="self-start">
            <Link href={href}>{ctaLabel}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="self-start" disabled>
            {ctaLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
