'use client';

/**
 * F13.10g-0 — Fechas límite de evaluaciones por periodo (temporada activa). El
 * admin fija/borra cada una de las 4 fechas; cada fila guarda al cambiar (con
 * revert si la RLS rechaza). Coord lo ve deshabilitado (solo admin escribe, D10).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Lock } from 'lucide-react';
import { DEVELOPMENT_PERIODS } from '@misterfc/core';
import { setAssessmentDeadline } from './actions';

type Props = {
  seasonId: string;
  seasonLabel: string;
  /** period → 'YYYY-MM-DD' | '' (sin fecha). */
  initial: Record<string, string>;
  canEdit: boolean;
};

type RowStatus = 'idle' | 'saving' | 'saved' | 'error';

export function DeadlinesForm({ seasonId, seasonLabel, initial, canEdit }: Props) {
  const t = useTranslations('ajustes');
  const tPeriod = useTranslations('informes.period');
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [, startTransition] = useTransition();

  function onChange(period: string, next: string) {
    const prev = values[period] ?? '';
    setValues((v) => ({ ...v, [period]: next }));
    setStatus((s) => ({ ...s, [period]: 'saving' }));
    startTransition(async () => {
      const res = await setAssessmentDeadline({
        season_id: seasonId,
        period,
        due_date: next === '' ? null : next,
      });
      if (res.error) {
        setValues((v) => ({ ...v, [period]: prev })); // revert
        setStatus((s) => ({ ...s, [period]: 'error' }));
        return;
      }
      setStatus((s) => ({ ...s, [period]: 'saved' }));
      setTimeout(() => setStatus((s) => ({ ...s, [period]: 'idle' })), 1800);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {t('assessment_deadlines.season', { season: seasonLabel })}
      </p>

      <ul className="flex flex-col divide-y divide-border">
        {DEVELOPMENT_PERIODS.map((period) => {
          const st = status[period] ?? 'idle';
          return (
            <li
              key={period}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span className="min-w-32 font-medium">{tPeriod(period)}</span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={values[period] ?? ''}
                  disabled={!canEdit || st === 'saving'}
                  onChange={(e) => onChange(period, e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-60"
                  aria-label={tPeriod(period)}
                />
                <span className="flex h-4 w-4 items-center justify-center text-xs">
                  {st === 'saving' && (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
                  )}
                  {st === 'saved' && (
                    <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  )}
                </span>
              </div>
              {st === 'error' && (
                <span className="w-full text-right text-xs text-red-600 dark:text-red-400">
                  {t('error.generic')}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!canEdit && (
        <p className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          {t('evaluations_visibility.read_only')}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('assessment_deadlines.hint')}</p>
    </div>
  );
}
