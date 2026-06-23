'use client';

/**
 * F13.10-editor — Rejilla de puntuación por catálogo: grupos → ítems puntuables
 * 1–10, con media por grupo y media global calculadas en vivo (computeGroupAverages
 * de core). Editable (selects + hidden input JSON para el form) o solo-lectura
 * (bloque de equipo fijo en el informe individual). El pulido visual es el paso
 * siguiente; aquí prima la jerarquía clara (grupo · ítem · media).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  computeGroupAverages,
  DEVELOPMENT_SCORE_MIN,
  DEVELOPMENT_SCORE_MAX,
  type Catalog,
} from '@misterfc/core';

const SELECT_CLASS =
  'w-16 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring disabled:opacity-60';

const SCALE = Array.from(
  { length: DEVELOPMENT_SCORE_MAX - DEVELOPMENT_SCORE_MIN + 1 },
  (_, i) => DEVELOPMENT_SCORE_MIN + i,
);

function fmt(avg: number | null): string {
  return avg === null ? '—' : avg.toFixed(1);
}

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

      {catalog.groups.map((group) => (
        <div key={group.id} className="rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{t(`cat_group.${group.id}`)}</span>
            <span className="text-xs text-muted-foreground">
              {t('group_average')}: <span className="font-semibold tabular-nums">{fmt(perGroup[group.id] ?? null)}</span>
            </span>
          </div>
          <ul className="divide-y">
            {group.items.map((itemId) => {
              const value = scores[itemId];
              return (
                <li key={itemId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm">{t(`cat.${itemId}`)}</span>
                  {readOnly ? (
                    <span className="w-16 text-right text-sm font-semibold tabular-nums">
                      {value ?? '—'}
                    </span>
                  ) : (
                    <select
                      aria-label={t(`cat.${itemId}`)}
                      className={SELECT_CLASS}
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
      ))}

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">{t('overall_average')}:</span>
        <span className="text-base font-bold tabular-nums">{fmt(overall)}</span>
      </div>
    </div>
  );
}
