'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type {
  AggregatedStats,
  DerivedRatios,
  AttendanceBreakdown,
  RatingTimelinePoint,
} from '@misterfc/core';
import { ATTENDANCE_CODES, timelineHasRatings } from '@misterfc/core';

// Carga diferida solo en cliente (ssr:false): mantiene recharts (+d3) fuera del
// bundle de servidor y del render SSR — ADR-0016 (mitigación del OOM de build).
const RatingEvolutionChart = dynamic(
  () => import('./rating-evolution-chart').then((m) => m.RatingEvolutionChart),
  { ssr: false }
);

type Props = {
  stats: AggregatedStats;
  ratios: DerivedRatios;
  attendance: AttendanceBreakdown;
  /** Serie de evolución de la valoración (9.3), ya ordenada por el server. */
  timeline: RatingTimelinePoint[];
  /** Temporadas de la trayectoria del jugador (desc), para el selector. */
  seasons: string[];
  /** Temporada actualmente mostrada. */
  activeSeason: string | null;
};

const BUCKETS = ['present', 'justified', 'unjustified', 'partial'] as const;

/**
 * F9.1 + F9.2 — Bloques de la temporada (vista staff): totales (9.1), ratios
 * derivados y desglose de asistencia (9.2), bajo un único selector de temporada.
 * Solo presenta: todo viene ya calculado del server. El selector navega con
 * `?season=` (el server re-consulta).
 */
export function PlayerSeasonStats({
  stats,
  ratios,
  attendance,
  timeline,
  seasons,
  activeSeason,
}: Props) {
  const t = useTranslations('jugadores.stats');
  const tCode = useTranslations('asistencia.codes');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onSeasonChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const np = new URLSearchParams(params);
    np.set('season', e.target.value);
    startTransition(() => {
      router.replace(`${pathname}?${np.toString()}`);
    });
  }

  const totals: Array<{ key: string; value: number }> = [
    { key: 'matches', value: stats.matches },
    { key: 'starts', value: stats.starts },
    { key: 'minutes', value: stats.minutesPlayed },
    { key: 'goals', value: stats.goals },
    { key: 'assists', value: stats.assists },
    { key: 'shots', value: stats.shots },
    { key: 'yellow_cards', value: stats.yellowCards },
    { key: 'red_cards', value: stats.redCards },
    { key: 'fouls_committed', value: stats.foulsCommitted },
    { key: 'fouls_received', value: stats.foulsReceived },
    { key: 'penalties_scored', value: stats.penaltiesScored },
    { key: 'penalties_missed', value: stats.penaltiesMissed },
  ];

  // null → "—"; el resto formateado según el tipo de ratio.
  const na = '—';
  const dec = (v: number | null) => (v == null ? na : v.toFixed(2));
  const whole = (v: number | null) => (v == null ? na : Math.round(v).toString());
  const pct = (v: number | null) =>
    v == null ? na : `${Math.round(v * 100)}%`;

  const ratioCards: Array<{ key: string; display: string }> = [
    { key: 'goals_per_match', display: dec(ratios.goalsPerMatch) },
    { key: 'goals_per_90', display: dec(ratios.goalsPer90) },
    { key: 'assists_per_match', display: dec(ratios.assistsPerMatch) },
    { key: 'minutes_per_match', display: whole(ratios.minutesPerMatch) },
    { key: 'start_rate', display: pct(ratios.startRate) },
    { key: 'cards_per_match', display: dec(ratios.cardsPerMatch) },
  ];

  const hasStats = stats.matches > 0;
  const hasAttendance = attendance.total > 0;
  const hasEvolution = timelineHasRatings(timeline);

  return (
    <div
      className="flex flex-col gap-5"
      data-pending={pending ? '' : undefined}
    >
      {seasons.length > 1 && activeSeason && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="season-select"
            className="text-sm text-muted-foreground"
          >
            {t('season_label')}
          </label>
          <select
            id="season-select"
            value={activeSeason}
            onChange={onSeasonChange}
            disabled={pending}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {!hasStats && !hasAttendance && !hasEvolution && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      {hasStats && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('totals_title')}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {totals.map((c) => (
              <div
                key={c.key}
                className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 p-3"
              >
                <span className="text-2xl font-bold tabular-nums">
                  {c.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`label.${c.key}`)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasStats && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('ratios_title')}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {ratioCards.map((c) => (
              <div
                key={c.key}
                className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 p-3"
              >
                <span className="text-2xl font-bold tabular-nums">
                  {c.display}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`ratio.${c.key}`)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasAttendance && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('attendance_title')}
          </h3>
          {/* Resumen: % presencia + total + conteo por bucket (ADR-0007). */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-misterfc-green/10 px-2 py-1 font-semibold text-misterfc-green">
              {pct(attendance.presentPct)} {t('attendance.present_pct')}
            </span>
            <span className="text-muted-foreground">
              {t('attendance.total', { count: attendance.total })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {BUCKETS.map((b) => (
              <span
                key={b}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                {t(`attendance.bucket.${b}`)}:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {attendance.perBucket[b]}
                </span>
              </span>
            ))}
          </div>
          {/* Desglose por código: solo los que tienen algún registro. */}
          <ul className="mt-1 flex flex-col divide-y divide-border rounded-md border border-border">
            {ATTENDANCE_CODES.filter((c) => attendance.perCode[c] > 0).map(
              (c) => (
                <li
                  key={c}
                  className="flex items-center justify-between px-3 py-1.5 text-sm"
                >
                  <span>{tCode(c)}</span>
                  <span className="font-medium tabular-nums">
                    {attendance.perCode[c]}
                  </span>
                </li>
              )
            )}
          </ul>
        </section>
      )}

      {hasEvolution && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('evolution.title')}
          </h3>
          <RatingEvolutionChart points={timeline} />
        </section>
      )}
    </div>
  );
}
