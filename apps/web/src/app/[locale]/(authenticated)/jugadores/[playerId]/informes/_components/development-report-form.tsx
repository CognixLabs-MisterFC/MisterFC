'use client';

/**
 * F13.10b-1 — Editor de un Informe de desarrollo (un periodo): los 4 corners con
 * escala 1–5 (opciones con descriptor genérico como guía) + comentario por corner
 * + comentario global. Upsert vía server action (useActionState). Sin control de
 * visibilidad (compartir = 13.10d).
 */

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { DEVELOPMENT_AXES, DEVELOPMENT_SCORE_MAX, type DevelopmentAxis } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  upsertDevelopmentReport,
  type DevelopmentReportState,
} from '../actions';

export type ReportInitial = {
  score_tecnica_tactica: number | null;
  score_fisica: number | null;
  score_psicologica: number | null;
  score_social: number | null;
  comment_tecnica_tactica: string | null;
  comment_fisica: string | null;
  comment_psicologica: string | null;
  comment_social: string | null;
  comment_overall: string | null;
};

type Props = {
  playerId: string;
  teamId: string;
  seasonId: string;
  period: string;
  initial: ReportInitial | null;
  canEdit: boolean;
};

const SCORES = Array.from({ length: DEVELOPMENT_SCORE_MAX }, (_, i) => i + 1);

export function DevelopmentReportForm({
  playerId,
  teamId,
  seasonId,
  period,
  initial,
  canEdit,
}: Props) {
  const t = useTranslations('informes');
  const [state, formAction, pending] = useActionState<DevelopmentReportState, FormData>(
    upsertDevelopmentReport,
    {},
  );

  const [lastHandled, setLastHandled] = useState(state);
  const [savedFlash, setSavedFlash] = useState(false);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setSavedFlash(true);
  }
  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="player_id" value={playerId} />
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="season_id" value={seasonId} />
      <input type="hidden" name="period" value={period} />

      {DEVELOPMENT_AXES.map((axis: DevelopmentAxis) => {
        const score = initial?.[`score_${axis}` as keyof ReportInitial] as number | null;
        const comment = initial?.[`comment_${axis}` as keyof ReportInitial] as string | null;
        return (
          <div key={axis} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`score_${axis}`} className="text-base font-semibold">
                {t(`axis.${axis}`)}
              </Label>
              {/* Select nativo: el descriptor 1–5 va en la opción como guía. */}
              <select
                id={`score_${axis}`}
                name={`score_${axis}`}
                defaultValue={score != null ? String(score) : ''}
                disabled={!canEdit}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
              >
                <option value="">{t('score.none')}</option>
                {SCORES.map((n) => (
                  <option key={n} value={String(n)}>
                    {n} · {t(`score.descriptor.${n}`)}
                  </option>
                ))}
              </select>
            </div>
            <Textarea
              name={`comment_${axis}`}
              rows={2}
              maxLength={2000}
              defaultValue={comment ?? ''}
              disabled={!canEdit}
              placeholder={t('comment_placeholder')}
            />
          </div>
        );
      })}

      <div className="flex flex-col gap-2">
        <Label htmlFor="comment_overall">{t('comment_overall')}</Label>
        <Textarea
          id="comment_overall"
          name="comment_overall"
          rows={4}
          maxLength={2000}
          defaultValue={initial?.comment_overall ?? ''}
          disabled={!canEdit}
          placeholder={t('comment_placeholder')}
        />
      </div>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}
      {savedFlash && !state.error && (
        <p className="text-sm text-misterfc-green" role="status">
          {t('saved')}
        </p>
      )}

      {canEdit && (
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('save')}</span>
          </Button>
        </div>
      )}
    </form>
  );
}
