import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  MapPin,
  Megaphone,
  Radio,
  Truck,
  XCircle,
} from 'lucide-react';
import { formatPlayerName } from '@misterfc/core';
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
import { PublishCallupDialog } from '../_components/publish-callup-dialog';
import { RepublishBanner } from '../_components/republish-banner';
import { ResponseButtons } from '../_components/response-buttons';
import { DecisionButtons } from '../_components/decision-buttons';
import { SharedLineupSection } from '@/components/match/shared-lineup-section';
import { loadCallupDetail } from '../queries';
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
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

function initials(first: string, last: string | null): string {
  const a = first.trim().charAt(0).toUpperCase();
  const b = (last ?? '').trim().charAt(0).toUpperCase();
  return `${b || a}${a || ''}`.slice(0, 2);
}

const RESPONSE_ICON = {
  yes: CheckCircle2,
  maybe: HelpCircle,
  no: XCircle,
} as const;

export default async function ConvocatoriaDetailPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED.includes(role)) redirect(`/${locale}`);

  const detail = await loadCallupDetail(
    ctx.activeClub.club.id,
    role,
    eventId
  );
  if (!detail) notFound();

  const t = await getTranslations('convocatorias');
  const tDetail = await getTranslations('convocatorias.detail');
  const tTransport = await getTranslations('convocatorias.transport');
  const tResponse = await getTranslations('convocatorias.response');
  const tDecision = await getTranslations('convocatorias.decision');

  const {
    event,
    roster,
    meta,
    responses,
    decisions,
    ownedPlayerIds,
    canManage,
    canManageLineup,
    hasUnpublishedChanges,
  } = detail;

  const isPlayer = role === 'jugador';
  const isPublished = meta?.published_at != null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/convocatorias">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{tDetail('back')}</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            <span>{fmtDate(event.starts_at, locale)}</span>
          </div>
          <CardTitle className="text-2xl">
            {event.title}
            {event.opponent_name && (
              <span className="ml-1 text-muted-foreground">
                · vs {event.opponent_name}
              </span>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span
              className="inline-flex items-center rounded-md border border-border bg-card/30 px-2 py-0.5 text-xs"
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
            {event.location_name && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {event.location_name}
                </span>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant={isPublished ? 'default' : 'secondary'}>
            {isPublished ? t('published') : t('draft')}
          </Badge>
          <div className="flex flex-wrap items-center gap-2">
            {canManageLineup && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/convocatorias/${event.id}/alineacion`}>
                  <ClipboardList className="size-4" aria-hidden />
                  <span>{tDetail('edit_lineup')}</span>
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/convocatorias/${event.id}/directo`}>
                  <Radio className="size-4" aria-hidden />
                  <span>{tDetail('live_capture')}</span>
                </Link>
              </Button>
            )}
            {canManage && (
            <PublishCallupDialog
              eventId={event.id}
              eventStartsAt={event.starts_at}
              initial={{
                meeting_at: meta?.meeting_at ?? null,
                meeting_location: meta?.meeting_location ?? null,
                meeting_address: meta?.meeting_address ?? null,
                transport_mode: meta?.transport_mode ?? null,
                transport_notes: meta?.transport_notes ?? null,
                notes_general: meta?.notes_general ?? null,
                published: isPublished,
              }}
            />
            )}
          </div>
        </CardContent>
      </Card>

      {canManage && hasUnpublishedChanges && (
        <RepublishBanner eventId={event.id} />
      )}

      {meta && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="size-5" aria-hidden />
              {tDetail('citation_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              <strong>{tDetail('citation_when')}:</strong>{' '}
              {fmtDate(meta.meeting_at, locale)}
            </p>
            <p>
              <strong>{tDetail('citation_where')}:</strong>{' '}
              {meta.meeting_location}
              {meta.meeting_address && (
                <span className="text-muted-foreground">
                  {' '}
                  · {meta.meeting_address}
                </span>
              )}
            </p>
            {meta.transport_mode && (
              <p>
                <Truck
                  className="mr-1 inline size-3.5"
                  aria-hidden
                />
                <strong>{tDetail('citation_transport')}:</strong>{' '}
                {tTransport(meta.transport_mode)}
                {meta.transport_notes && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {meta.transport_notes}
                  </span>
                )}
              </p>
            )}
            {meta.notes_general && (
              <p className="rounded-md border border-border bg-card/30 p-2 text-xs">
                {meta.notes_general}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isPlayer ? (
        // Vista jugador / familia: solo sus jugadores.
        <Card>
          <CardHeader>
            <CardTitle>{tDetail('player_section_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!isPublished ? (
              <p className="text-sm text-muted-foreground">
                {tDetail('not_published_yet')}
              </p>
            ) : roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tDetail('not_in_roster')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {roster.map((p) => {
                  const resp = responses.get(p.id);
                  return (
                    <li key={p.id} className="py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                          aria-hidden
                        >
                          {initials(p.first_name, p.last_name)}
                        </span>
                        <span className="font-medium">
                          {formatPlayerName(p.first_name, p.last_name)}
                        </span>
                        {p.dorsal != null && (
                          <span className="text-xs text-muted-foreground">
                            #{p.dorsal}
                          </span>
                        )}
                      </div>
                      {ownedPlayerIds.includes(p.id) ? (
                        <ResponseButtons
                          eventId={event.id}
                          playerId={p.id}
                          initial={resp?.status ?? null}
                          initialReason={resp?.reason ?? null}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {tDetail('not_linked')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        // Vista entrenador: tabla con todas las respuestas + decisión.
        <Card>
          <CardHeader>
            <CardTitle>{tDetail('coach_section_title')}</CardTitle>
            {!isPublished && (
              <p className="text-xs text-muted-foreground">
                {tDetail('draft_hint')}
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {roster.map((p) => {
                const resp = responses.get(p.id);
                const dec = decisions.get(p.id);
                const RespIcon = resp ? RESPONSE_ICON[resp.status] : null;
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        aria-hidden
                      >
                        {initials(p.first_name, p.last_name)}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {formatPlayerName(p.first_name, p.last_name)}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {p.dorsal != null && <span>#{p.dorsal}</span>}
                          {resp && RespIcon && (
                            <span className="flex items-center gap-1">
                              <RespIcon className="size-3" aria-hidden />
                              {tResponse(resp.status)}
                            </span>
                          )}
                          {!resp && (
                            <span>{tDetail('no_response_yet')}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    <DecisionButtons
                      eventId={event.id}
                      playerId={p.id}
                      initial={dec?.decision ?? null}
                      initialReason={dec?.reason ?? null}
                      disabled={!canManage}
                    />
                  </li>
                );
              })}
            </ul>
            {!canManage && (
              <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
                {tDetail('coach_readonly_hint')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* F6 Lote B — alineación oficial compartida (solo si visibility=team). */}
      {isPlayer && <SharedLineupSection eventId={event.id} />}

      {/* Resumen de descartes técnicos */}
      {!isPlayer && decisions.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tDetail('decisions_summary')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  {tDecision('called_up')}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {roster
                    .map((p) => ({ p, d: decisions.get(p.id) }))
                    .filter((x) => x.d?.decision === 'called_up')
                    .map(({ p }) => (
                      <li key={p.id} className="text-sm">
                        {formatPlayerName(p.first_name, p.last_name)}
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {tDecision('discarded')}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {roster
                    .map((p) => ({ p, d: decisions.get(p.id) }))
                    .filter((x) => x.d?.decision === 'discarded')
                    .map(({ p, d }) => (
                      <li key={p.id} className="text-sm">
                        {formatPlayerName(p.first_name, p.last_name)}
                        {d?.reason && (
                          <span className="ml-1 text-xs italic text-muted-foreground">
                            · {d.reason}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
