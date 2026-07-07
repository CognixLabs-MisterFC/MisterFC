'use client';

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  matchPhase,
  type ClockPeriod,
  type MatchPhaseKind,
} from '@misterfc/core';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useVisibleInterval,
  CHAT_POLL_INTERVAL_MS,
} from '@/hooks/use-chat-polling';
import { fetchMatchDetail } from '../actions';
import type { MatchDetail } from '../queries';

type Props = { initial: MatchDetail };

/** "Ahora" como external store (patrón match-clock): sin Date.now() en render. */
function useTickingNow(active: boolean): number | null {
  const nowRef = useRef<number | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      nowRef.current = Date.now();
      onChange();
      if (!active) return () => {};
      const id = setInterval(() => {
        nowRef.current = Date.now();
        onChange();
      }, 1000);
      return () => clearInterval(id);
    },
    [active],
  );
  return useSyncExternalStore(
    subscribe,
    () => nowRef.current,
    () => null,
  );
}

/** Fallback para el primer paint (SSR): arranque del periodo en curso → elapsed 0. */
function frozenNow(periods: ClockPeriod[]): number {
  const running = periods.find((p) => p.running && p.lastStartedAt);
  return running?.lastStartedAt ? Date.parse(running.lastStartedAt) : 0;
}

const LIVE_PHASES: ReadonlySet<MatchPhaseKind> = new Set([
  'first_half',
  'second_half',
  'extra_time',
]);

// Tipos de evento que se listan (fase de partido: goles, tarjetas, etc.).
const LISTED_EVENTS = new Set([
  'goal',
  'penalty',
  'assist',
  'yellow_card',
  'red_card',
  'substitution',
  'corner',
  'foul',
  'offside',
  'shot',
]);

export function DirectoDetailClient({ initial }: Props) {
  const t = useTranslations('directos');
  const [detail, setDetail] = useState<MatchDetail>(initial);

  const isLive = detail.status === 'live';
  const now = useTickingNow(isLive);

  const poll = useCallback(async () => {
    const fresh = await fetchMatchDetail(detail.eventId);
    if (fresh) setDetail(fresh);
  }, [detail.eventId]);
  useVisibleInterval(poll, CHAT_POLL_INTERVAL_MS, isLive);

  const { phase, minute, addedTime } = matchPhase({
    status: detail.status,
    periods: detail.periods,
    halfDurationMinutes: detail.halfDurationMinutes,
    nowMs: now ?? frozenNow(detail.periods),
  });
  const minuteText =
    addedTime > 0
      ? t('minute_added', { minute, added: addedTime })
      : t('minute', { minute });

  const fieldPlayers: FieldEditorPlayer[] = detail.fieldPlayers.map((p) => ({
    playerId: p.playerId,
    label: p.label,
    dorsal: p.dorsal,
    positionCode: p.positionCode,
    xPct: p.xPct,
    yPct: p.yPct,
  }));

  const ts = detail.teamStats;
  const statRows: { key: string; own: number; rival: number }[] = [
    { key: 'goals', own: detail.goalsOwn, rival: detail.goalsRival },
    { key: 'shots', own: ts.shots.own, rival: ts.shots.rival },
    { key: 'corners', own: ts.corners.own, rival: ts.corners.rival },
    { key: 'fouls', own: ts.fouls.own, rival: ts.fouls.rival },
    { key: 'yellow', own: ts.yellowCards.own, rival: ts.yellowCards.rival },
    { key: 'red', own: ts.redCards.own, rival: ts.redCards.rival },
    { key: 'offsides', own: ts.offsides.own, rival: ts.offsides.rival },
  ];

  const listed = detail.events.filter((e) => LISTED_EVENTS.has(e.type));

  return (
    <div className="flex flex-col gap-4">
      {/* Marcador + estado + minuto */}
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-5 text-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: detail.teamColor }}
              aria-hidden
            />
            <span>{detail.categoryName}</span>
          </div>
          <div className="text-2xl font-bold tracking-tight">
            <span>{detail.teamName}</span>{' '}
            <span className="tabular-nums">
              {detail.goalsOwn} - {detail.goalsRival}
            </span>{' '}
            <span>{detail.opponentName ?? ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={isLive ? 'default' : 'secondary'}
              className={isLive ? 'bg-red-500 text-white hover:bg-red-500' : ''}
            >
              {isLive ? t('live') : t(`phase.${phase}`)}
            </Badge>
            <span className="text-sm text-muted-foreground tabular-nums">
              {isLive && LIVE_PHASES.has(phase)
                ? minuteText
                : t(`phase.${phase}`)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Campo (alineación) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('field_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.hasLineup && fieldPlayers.length > 0 ? (
            <MatchFieldEditor
              format={detail.format}
              formationCode={detail.formationCode}
              players={fieldPlayers}
              mode="readonly"
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('no_lineup')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Estadísticas */}
      <Card>
        <CardHeader>
          <CardTitle>{t('stats_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-y-2 text-sm">
            <span className="text-right font-semibold tabular-nums">
              {t('us')}
            </span>
            <span className="text-center text-xs text-muted-foreground" />
            <span className="text-left font-semibold tabular-nums">
              {t('them')}
            </span>
            {statRows.map((r) => (
              <FragmentRow key={r.key} label={t(`stat.${r.key}`)} own={r.own} rival={r.rival} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Eventos */}
      <Card>
        <CardHeader>
          <CardTitle>{t('events_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {listed.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('no_events')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {listed.map((e) => {
                const min = e.displayMinute ?? Math.floor(e.clockSeconds / 60);
                return (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {min}&apos;
                    </span>
                    <span className="font-medium">{t(`event.${e.type}`)}</span>
                    <span className="truncate text-muted-foreground">
                      {e.side === 'rival' ? `${t('event.rival')} ${e.label}` : e.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Fila de estadística: propio · etiqueta · rival. */
function FragmentRow({
  label,
  own,
  rival,
}: {
  label: string;
  own: number;
  rival: number;
}) {
  return (
    <>
      <span className="text-right tabular-nums">{own}</span>
      <span className="text-center text-xs text-muted-foreground">{label}</span>
      <span className="text-left tabular-nums">{rival}</span>
    </>
  );
}
