'use client';

import {
  useCallback,
  useMemo,
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
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useVisibleInterval,
  CHAT_POLL_INTERVAL_MS,
} from '@/hooks/use-chat-polling';
import { fetchWeekMatches } from './actions';
import type { WeekMatch } from './queries';

type Props = {
  locale: string;
  initialMatches: WeekMatch[];
};

/**
 * "Ahora" en ms como external store (patrón de match-clock, F7.7): Date.now() se
 * llama en subscribe, NO en render (React Compiler: sin impurezas en render).
 * getServerSnapshot → null → sin desajuste de hidratación. Tictaquea 1s si `active`.
 */
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

export function DirectosListClient({ locale, initialMatches }: Props) {
  const t = useTranslations('directos');
  const [matches, setMatches] = useState<WeekMatch[]>(initialMatches);

  const anyLive = matches.some((m) => m.status === 'live');
  const now = useTickingNow(anyLive);

  // Polling ~5s de los partidos en vivo (marcador/estado/reloj). Pausa oculto.
  const poll = useCallback(async () => {
    const fresh = await fetchWeekMatches();
    setMatches(fresh);
  }, []);
  useVisibleInterval(poll, CHAT_POLL_INTERVAL_MS, anyLive);

  // Fecha (día de semana + día) y hora por separado → "Sáb 12 · 10:30".
  // timeZone fija (Europe/Madrid) para no desajustar entre SSR y cliente.
  const fmtDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        timeZone: 'Europe/Madrid',
      }),
    [locale],
  );
  const fmtTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Madrid',
      }),
    [locale],
  );
  const kickoff = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      const date = fmtDate.format(d).replace(/,/g, '');
      const cap = date.charAt(0).toUpperCase() + date.slice(1);
      return `${cap} · ${fmtTime.format(d)}`;
    },
    [fmtDate, fmtTime],
  );

  if (matches.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {matches.map((m) => {
        const { phase, minute, addedTime } = matchPhase({
          status: m.status,
          periods: m.periods,
          halfDurationMinutes: m.halfDurationMinutes,
          nowMs: now ?? frozenNow(m.periods),
        });
        const isLive = m.status === 'live';
        const showMinute = LIVE_PHASES.has(phase);
        const minuteText =
          addedTime > 0
            ? t('minute_added', { minute, added: addedTime })
            : t('minute', { minute });

        return (
          <li key={m.eventId}>
            <Link href={`/directos/${m.eventId}`}>
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: m.teamColor }}
                        aria-hidden
                      />
                      <span className="truncate">{m.categoryName}</span>
                    </div>
                    {/* Marcador o "vs". */}
                    <div className="truncate font-semibold">
                      {m.goalsOwn != null ? (
                        <span>
                          {m.teamName}{' '}
                          <span className="tabular-nums">
                            {m.goalsOwn} - {m.goalsRival}
                          </span>{' '}
                          {m.opponentName ?? ''}
                        </span>
                      ) : (
                        <span>
                          {m.teamName} {t('vs')} {m.opponentName ?? ''}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {kickoff(m.startsAt)}
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      variant={isLive ? 'default' : 'secondary'}
                      className={
                        isLive ? 'bg-red-500 text-white hover:bg-red-500' : ''
                      }
                    >
                      {isLive ? t('live') : t(`phase.${phase}`)}
                    </Badge>
                    {isLive && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {showMinute ? minuteText : t(`phase.${phase}`)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
