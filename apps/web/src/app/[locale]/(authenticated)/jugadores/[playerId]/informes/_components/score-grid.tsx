'use client';

/**
 * F13.10 — Rejilla de puntuación por catálogo: grupos → ítems puntuables 1–10, con
 * media por grupo y media global (computeGroupAverages de core) y CÓDIGO DE COLOR
 * por nota (score-color tokens). Editable (selects coloreados + hidden input JSON)
 * o solo-lectura (chips coloreados, para la ficha y el bloque de equipo fijo).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  computeGroupAverages,
  DEVELOPMENT_SCORE_MIN,
  DEVELOPMENT_SCORE_MAX,
  type Catalog,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { scoreClasses, formatScore } from '@/lib/score-color';

const SCALE = Array.from(
  { length: DEVELOPMENT_SCORE_MAX - DEVELOPMENT_SCORE_MIN + 1 },
  (_, i) => DEVELOPMENT_SCORE_MIN + i,
);

export function ScoreGrid({
  catalog,
  initial,
  readOnly = false,
  name = 'scores',
}: {
  catalog: Catalog;
  initial: Record<string, number>;
  readOnly?: boolean;
  name?: string;
}) {
  const t = useTranslations('informes');
  const [scores, setScores] = useState<Record<string, number>>(initial);

  const { perGroup, overall } = computeGroupAverages(catalog, scores);

  const setItem = (itemId: string, value: string) => {
    setScores((prev) => {
      const next = { ...prev };
      if (value === '') delete next[itemId];
      else next[itemId] = Number(value);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {!readOnly ? <input type="hidden" name={name} value={JSON.stringify(scores)} /> : null}

      {catalog.groups.map((group) => {
        const avg = perGroup[group.id] ?? null;
        return (
          <div key={group.id} className="overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">{t(`cat_group.${group.id}`)}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t('group_average')}
                <span
                  className={cn(
                    'inline-flex min-w-9 justify-center rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums',
                    scoreClasses(avg),
                  )}
                >
                  {formatScore(avg)}
                </span>
              </span>
            </div>
            <ul className="divide-y">
              {group.items.map((itemId) => {
                const value = scores[itemId];
                return (
                  <li key={itemId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">{t(`cat.${itemId}`)}</span>
                    {readOnly ? (
                      <span
                        className={cn(
                          'inline-flex w-10 justify-center rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums',
                          scoreClasses(value),
                        )}
                      >
                        {value ?? '—'}
                      </span>
                    ) : (
                      <select
                        aria-label={t(`cat.${itemId}`)}
                        className={cn(
                          'w-16 rounded-md border px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                          scoreClasses(value),
                        )}
                        value={value ?? ''}
                        onChange={(e) => setItem(itemId, e.target.value)}
                      >
                        <option value="">—</option>
                        {SCALE.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">{t('overall_average')}</span>
        <span
          className={cn(
            'inline-flex min-w-11 justify-center rounded-md border px-2.5 py-1 text-base font-bold tabular-nums',
            scoreClasses(overall),
          )}
        >
          {formatScore(overall)}
        </span>
      </div>
    </div>
  );
}
