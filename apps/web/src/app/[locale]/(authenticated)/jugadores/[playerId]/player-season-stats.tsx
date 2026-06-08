'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AggregatedStats } from '@misterfc/core';

type Props = {
  stats: AggregatedStats;
  /** Temporadas de la trayectoria del jugador (desc), para el selector. */
  seasons: string[];
  /** Temporada actualmente mostrada. */
  activeSeason: string | null;
};

/**
 * F9.1 — Bloque de stats agregadas de la temporada (vista staff) + selector de
 * temporada. Solo presenta: los totales ya vienen sumados del server
 * (`sumMatchStats`). El selector navega con `?season=` (server re-consulta).
 */
export function PlayerSeasonStats({ stats, seasons, activeSeason }: Props) {
  const t = useTranslations('jugadores.stats');
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

  // Orden de las tarjetas (clave i18n → valor).
  const cards: Array<{ key: string; value: number }> = [
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

  return (
    <div className="flex flex-col gap-4">
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

      {stats.matches === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          data-pending={pending ? '' : undefined}
        >
          {cards.map((c) => (
            <div
              key={c.key}
              className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 p-3"
            >
              <span className="text-2xl font-bold tabular-nums">{c.value}</span>
              <span className="text-xs text-muted-foreground">
                {t(`label.${c.key}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
