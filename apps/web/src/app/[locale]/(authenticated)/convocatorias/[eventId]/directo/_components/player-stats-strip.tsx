'use client';

/**
 * F7.8 — Tabla de tiempo de juego y stats por jugador EN VIVO.
 *
 * Vista CALCULADA (no materializa nada; el cierre/consolidación es 7.10). Todo el
 * cálculo lo hace el motor puro de @misterfc/core (`computePlayerMatchStats` sobre
 * `clockSecondsAt`, subs y eventos): aquí solo tictaqueamos el reloj (1 s mientras
 * corre) y pintamos. Sobrevive a recargas porque deriva de lo PERSISTIDO
 * (match_starters + match_events + match_periods), reconstruido por el padre.
 *
 * "Ha jugado poco": umbral configurable (% del tiempo de juego transcurrido) +
 * destaca los N menos jugados (§8).
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import {
  clockSecondsAt,
  computePlayerMatchStats,
  currentPeriod,
  flagLowPlaytime,
  isClockRunning,
  leastPlayedIds,
  type ClockPeriod,
  type MatchEventLite,
} from '@misterfc/core';
import { cn } from '@/lib/utils';

/** Jugador del convocado para pintar la fila (nombre/dorsal). */
export type StatsPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
};

type Props = {
  periods: ClockPeriod[];
  matchStatus: 'not_started' | 'live' | 'closed';
  /** Convocado, en orden de visualización (campo primero, luego banquillo). */
  players: StatsPlayer[];
  /** Once inicial congelado (match_starters): entran en clock 0. */
  starterIds: string[];
  /** Eventos propios (subs + gol/asistencia/tarjetas) ya fusionados (persistido+optimista). */
  events: MatchEventLite[];
  /** Ausentes (match_absences): 0 min, marcados aparte. */
  absentIds: string[];
  /** Expulsados (1 roja O 2 amarillas), estado derivado del padre. */
  expelledIds: string[];
};

// % por defecto del "ha jugado poco": por debajo de la mitad del tiempo jugado.
const DEFAULT_THRESHOLD_PCT = 50;
// Cuántos de los menos jugados se destacan, además del umbral (§8).
const LEAST_PLAYED_N = 3;
const THRESHOLD_STEPS = [30, 40, 50, 60, 70] as const;

/**
 * "Ahora" en ms como external store (mismo patrón que el cronómetro): tictaquea
 * 1 s solo si el reloj corre; en servidor → null (caemos a `frozenNow`).
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

/** Reloj plegado para el primer paint/servidor (elapsed corrido = 0). */
function frozenNow(periods: ClockPeriod[]): number {
  const cur = currentPeriod(periods);
  if (cur?.running && cur.lastStartedAt) return Date.parse(cur.lastStartedAt);
  return 0;
}

export function PlayerStatsStrip({
  periods,
  matchStatus,
  players,
  starterIds,
  events,
  absentIds,
  expelledIds,
}: Props) {
  const t = useTranslations('partido_directo');
  const [thresholdPct, setThresholdPct] = useState<number>(DEFAULT_THRESHOLD_PCT);

  const running = isClockRunning(periods);
  const now = useTickingNow(running);
  const matchClockSeconds = clockSecondsAt(periods, now ?? frozenNow(periods));

  const absentSet = useMemo(() => new Set(absentIds), [absentIds]);
  const expelledSet = useMemo(() => new Set(expelledIds), [expelledIds]);

  const rows = useMemo(
    () =>
      computePlayerMatchStats({
        starterIds,
        events,
        matchClockSeconds,
        absentIds,
        rosterIds: players.map((p) => p.playerId),
      }),
    [starterIds, events, matchClockSeconds, absentIds, players],
  );

  // "Ha jugado poco": por debajo del umbral O entre los N menos jugados. Los
  // ausentes no se marcan (no es que hayan jugado poco: no están disponibles).
  const lowSet = useMemo(() => {
    const eligible = rows.filter((r) => !absentSet.has(r.playerId));
    const byThreshold = flagLowPlaytime(eligible, matchClockSeconds, thresholdPct);
    const least = leastPlayedIds(eligible, LEAST_PLAYED_N);
    const merged = new Set<string>(byThreshold);
    if (matchClockSeconds > 0) for (const id of least) merged.add(id);
    return merged;
  }, [rows, absentSet, matchClockSeconds, thresholdPct]);

  const infoOf = useMemo(() => {
    const m = new Map<string, StatsPlayer>();
    for (const p of players) m.set(p.playerId, p);
    return m;
  }, [players]);

  const notStarted = matchStatus === 'not_started';

  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('stats_title')}
        </p>
        {/* Umbral configurable del "ha jugado poco" (% del tiempo transcurrido). */}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t('stats_low_threshold')}</span>
          <select
            value={thresholdPct}
            onChange={(e) => setThresholdPct(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
            aria-label={t('stats_low_threshold')}
          >
            {THRESHOLD_STEPS.map((pct) => (
              <option key={pct} value={pct}>
                {pct}%
              </option>
            ))}
          </select>
        </label>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('stats_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 font-medium">{t('stats_col_player')}</th>
                <th className="px-2 py-1 text-right font-medium tabular-nums">
                  {t('stats_col_minutes')}
                </th>
                <th className="px-2 py-1 text-right font-medium tabular-nums">
                  {t('stats_col_goals')}
                </th>
                <th className="px-2 py-1 text-right font-medium tabular-nums">
                  {t('stats_col_assists')}
                </th>
                <th className="px-2 py-1 text-right font-medium tabular-nums">
                  {t('stats_col_yellows')}
                </th>
                <th className="pl-2 py-1 text-right font-medium tabular-nums">
                  {t('stats_col_reds')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const info = infoOf.get(r.playerId);
                const label = info?.label ?? r.playerId.slice(0, 4);
                const dorsal = info?.dorsal ?? null;
                const isAbsent = absentSet.has(r.playerId);
                const isExpelled = expelledSet.has(r.playerId);
                const isLow = !isAbsent && !notStarted && lowSet.has(r.playerId);
                return (
                  <tr
                    key={r.playerId}
                    className={cn(
                      'border-b border-border/40 last:border-0',
                      isAbsent && 'opacity-50',
                    )}
                  >
                    <td className="py-1 pr-2">
                      <span className="flex items-center gap-1.5">
                        {dorsal != null && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {dorsal}
                          </span>
                        )}
                        <span className="truncate">{label}</span>
                        {isLow && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-700 dark:text-amber-400"
                            title={t('stats_low_hint', { pct: thresholdPct })}
                          >
                            <AlertTriangle className="size-3" aria-hidden />
                            {t('stats_low_badge')}
                          </span>
                        )}
                        {isAbsent && (
                          <span className="rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-700 dark:text-amber-400">
                            {t('bench_status.absent')}
                          </span>
                        )}
                        {isExpelled && !isAbsent && (
                          <span className="rounded bg-red-500/15 px-1 text-[10px] uppercase text-red-600 dark:text-red-400">
                            {t('bench_status.expelled')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {t('stats_minutes', { n: r.playedMinutes })}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.goals || <span className="text-muted-foreground">·</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.assists || <span className="text-muted-foreground">·</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.yellowCards || <span className="text-muted-foreground">·</span>}
                    </td>
                    <td className="pl-2 py-1 text-right tabular-nums">
                      {r.redCards || <span className="text-muted-foreground">·</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
        {t('stats_hint')}
      </p>
    </div>
  );
}
