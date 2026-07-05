'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type {
  AggregatedStats,
  MatchStatsByType,
  DerivedRatios,
  AttendanceBreakdown,
  RatingTimelinePoint,
} from '@misterfc/core';
import { ATTENDANCE_CODES, timelineHasRatings } from '@misterfc/core';
import type { PlayerCareer } from '@/lib/player-career';
import {
  MatchStatsByTypeTable,
  type MatchStatsByTypeRow,
} from '@/components/stats/match-stats-by-type-table';

// Carga diferida solo en cliente (ssr:false): mantiene recharts (+d3) fuera del
// bundle de servidor y del render SSR — ADR-0016 (mitigación del OOM de build).
const RatingEvolutionChart = dynamic(
  () => import('./rating-evolution-chart').then((m) => m.RatingEvolutionChart),
  { ssr: false }
);
const SeasonComparisonChart = dynamic(
  () => import('./season-comparison-chart').then((m) => m.SeasonComparisonChart),
  { ssr: false }
);

type Mode = 'season' | 'career';

type Props = {
  stats: AggregatedStats;
  /** F9B-3 — desglose por tipo (modo Temporada). `total` = el mismo que `stats`. */
  statsByType: MatchStatsByType;
  ratios: DerivedRatios;
  attendance: AttendanceBreakdown;
  /** Serie de evolución de la valoración (9.3), ya ordenada por el server. */
  timeline: RatingTimelinePoint[];
  /** Temporadas de la trayectoria del jugador (desc), para el selector. */
  seasons: string[];
  /** Temporada actualmente mostrada. */
  activeSeason: string | null;
  /** F9.4 — agregación multi-temporada (carrera). Habilita el toggle Carrera. */
  career?: PlayerCareer;
};

const BUCKETS = ['present', 'justified', 'unjustified', 'partial'] as const;

const na = '—';
const dec = (v: number | null) => (v == null ? na : v.toFixed(2));
const whole = (v: number | null) => (v == null ? na : Math.round(v).toString());
const pct = (v: number | null) => (v == null ? na : `${Math.round(v * 100)}%`);

function buildTotals(s: AggregatedStats): Array<{ key: string; value: number }> {
  return [
    { key: 'matches', value: s.matches },
    { key: 'starts', value: s.starts },
    { key: 'minutes', value: s.minutesPlayed },
    { key: 'goals', value: s.goals },
    { key: 'assists', value: s.assists },
    { key: 'shots', value: s.shots },
    { key: 'yellow_cards', value: s.yellowCards },
    { key: 'red_cards', value: s.redCards },
    { key: 'fouls_committed', value: s.foulsCommitted },
    { key: 'fouls_received', value: s.foulsReceived },
    { key: 'penalties_scored', value: s.penaltiesScored },
    { key: 'penalties_missed', value: s.penaltiesMissed },
  ];
}

function buildRatioCards(
  r: DerivedRatios
): Array<{ key: string; display: string }> {
  return [
    { key: 'goals_per_match', display: dec(r.goalsPerMatch) },
    { key: 'goals_per_90', display: dec(r.goalsPer90) },
    { key: 'assists_per_match', display: dec(r.assistsPerMatch) },
    { key: 'minutes_per_match', display: whole(r.minutesPerMatch) },
    { key: 'start_rate', display: pct(r.startRate) },
    { key: 'cards_per_match', display: dec(r.cardsPerMatch) },
  ];
}

/**
 * F9.1 + F9.2 + F9.4 — Bloques de stats del jugador (vista staff y /mi-ficha).
 * Toggle Temporada/Carrera (§2.3): en "Temporada" los totales/ratios/asistencia/
 * evolución de la temporada seleccionada (9.1/9.2/9.3, sin cambios); en "Carrera"
 * los totales de carrera + ratios + tabla por temporada + gráfico de comparación
 * (9.4). Solo presenta: todo viene calculado del server (`careerBySeason`/
 * `careerTotals` en core). El selector de temporada navega con `?season=`.
 */
export function PlayerSeasonStats({
  stats,
  statsByType,
  ratios,
  attendance,
  timeline,
  seasons,
  activeSeason,
  career,
}: Props) {
  const t = useTranslations('jugadores.stats');
  const tCode = useTranslations('asistencia.codes');
  // F9B-3 — etiquetas de columnas + "Tarjetas" reutilizadas del informe (mismas
  // claves informes.ficha.*), para no divergir del bloque de 4 columnas del PDF/ficha.
  const tInf = useTranslations('informes');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>('season');

  function onSeasonChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const np = new URLSearchParams(params);
    np.set('season', e.target.value);
    startTransition(() => {
      router.replace(`${pathname}?${np.toString()}`);
    });
  }

  const ratioCards = buildRatioCards(ratios);

  // F9B-3 — desglose de las 12 métricas del perfil por tipo (Amistoso·Torneo·
  // Oficial·Total), ordenadas por relevancia. Se pinta con el componente
  // compartido MatchStatsByTypeTable (el mismo del informe). Ratios/asistencia/
  // evolución/carrera NO cambian.
  const cellVal = (key: string, agg: AggregatedStats): string => {
    switch (key) {
      case 'matches':
        return String(agg.matches);
      case 'minutes':
        return String(agg.minutesPlayed);
      case 'goals':
        return String(agg.goals);
      case 'assists':
        return String(agg.assists);
      case 'cards':
        return String(agg.yellowCards + agg.redCards);
      case 'start_rate':
        return pct(agg.matches > 0 ? agg.starts / agg.matches : null);
      case 'shots':
        return String(agg.shots);
      case 'fouls_committed':
        return String(agg.foulsCommitted);
      case 'fouls_received':
        return String(agg.foulsReceived);
      case 'penalties_scored':
        return String(agg.penaltiesScored);
      case 'penalties_missed':
        return String(agg.penaltiesMissed);
      case 'starts':
        return String(agg.starts);
      default:
        return na;
    }
  };
  const PROFILE_METRIC_KEYS = [
    'matches',
    'minutes',
    'goals',
    'assists',
    'cards',
    'start_rate',
    'shots',
    'fouls_committed',
    'fouls_received',
    'penalties_scored',
    'penalties_missed',
    'starts',
  ] as const;
  const labelFor = (key: string): string =>
    key === 'cards'
      ? tInf('ficha.stat.cards')
      : key === 'start_rate'
        ? t('ratio.start_rate')
        : t(`label.${key}`);
  const byTypeRows: MatchStatsByTypeRow[] = PROFILE_METRIC_KEYS.map((key) => ({
    key,
    label: labelFor(key),
    cells: {
      amistoso: cellVal(key, statsByType.amistoso),
      torneo: cellVal(key, statsByType.torneo),
      oficial: cellVal(key, statsByType.oficial),
      total: cellVal(key, statsByType.total),
    },
  }));
  const byTypeColumns = {
    friendly: tInf('ficha.friendly'),
    tournament: tInf('ficha.tournament'),
    official: tInf('ficha.official'),
    total: tInf('ficha.total'),
  };

  const hasStats = stats.matches > 0;
  const hasAttendance = attendance.total > 0;
  const hasEvolution = timelineHasRatings(timeline);

  // El toggle de carrera solo tiene sentido si hay datos multi-temporada.
  const showToggle = career != null && seasons.length > 0;
  const effectiveMode: Mode = showToggle ? mode : 'season';

  const careerTotalsCards = career ? buildTotals(career.totals.stats) : [];
  const careerRatioCards = career ? buildRatioCards(career.totals.ratios) : [];
  const careerHasStats = (career?.totals.stats.matches ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5" data-pending={pending ? '' : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        {showToggle && (
          <div
            role="tablist"
            aria-label={t('mode.label')}
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {(['season', 'career'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={effectiveMode === m}
                onClick={() => setMode(m)}
                className={
                  effectiveMode === m
                    ? 'rounded px-3 py-1 text-sm font-medium bg-misterfc-green/10 text-misterfc-green'
                    : 'rounded px-3 py-1 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
        )}

        {effectiveMode === 'season' && seasons.length > 1 && activeSeason && (
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
      </div>

      {effectiveMode === 'season' && (
        <>
          {!hasStats && !hasAttendance && !hasEvolution && (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          )}

          {hasStats && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('totals_title')}
              </h3>
              {/* F9B-3 — totales desglosados por tipo (Amistoso·Torneo·Oficial·
                  Total), componente compartido con el informe. */}
              <MatchStatsByTypeTable columns={byTypeColumns} rows={byTypeRows} />
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
        </>
      )}

      {effectiveMode === 'career' && career && (
        <>
          {!careerHasStats && (
            <p className="text-sm text-muted-foreground">{t('career.empty')}</p>
          )}

          {careerHasStats && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('career.totals_title')}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {careerTotalsCards.map((c) => (
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

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('career.ratios_title')}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {careerRatioCards.map((c) => (
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

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('career.by_season_title')}
                </h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">
                          {t('career.table.season')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('label.matches')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('label.minutes')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('label.goals')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('label.assists')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('ratio.start_rate')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('career.table.rating')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.bySeason.map((s) => (
                        <tr
                          key={s.season}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="px-3 py-2 font-medium">{s.season}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.stats.matches}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.stats.minutesPlayed}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.stats.goals}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.stats.assists}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {pct(s.ratios.startRate)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {dec(s.rating)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('career.comparison_title')}
                </h3>
                <SeasonComparisonChart bySeason={career.bySeason} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
