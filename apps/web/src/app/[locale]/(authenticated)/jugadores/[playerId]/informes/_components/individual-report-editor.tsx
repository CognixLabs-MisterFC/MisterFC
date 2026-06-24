'use client';

/**
 * F13.10-editor — Parte EDITABLE del informe individual (player×season×period):
 * rejilla DEVELOPMENT_REPORT_CATALOG + comentario general + visibilidad. El bloque
 * de equipo (fijo, no editable) lo pinta la página por encima de este form.
 */

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { DEVELOPMENT_REPORT_CATALOG, DEVELOPMENT_COMMENT_MAX } from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGrid } from './score-grid';
import { upsertDevelopmentReport, type ReportState } from '../actions';
import type { IndividualReport } from '../queries';

export function IndividualReportEditor({
  playerId,
  teamId,
  seasonId,
  period,
  initial,
}: {
  playerId: string;
  teamId: string;
  seasonId: string;
  period: string;
  initial: IndividualReport | null;
}) {
  const t = useTranslations('informes');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ReportState['error'] | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await upsertDevelopmentReport({}, fd);
      if (res.error) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('individual_report')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <input type="hidden" name="player_id" value={playerId} />
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="season_id" value={seasonId} />
          <input type="hidden" name="period" value={period} />

          <ScoreGrid catalog={DEVELOPMENT_REPORT_CATALOG} initial={initial?.scores ?? {}} />

          <div className="flex flex-col gap-1">
            <Label htmlFor="ind-comment">{t('comment_overall')}</Label>
            <Textarea
              id="ind-comment"
              name="comment_overall"
              rows={3}
              maxLength={DEVELOPMENT_COMMENT_MAX}
              defaultValue={initial?.comment_overall ?? ''}
              placeholder={t('comment_placeholder')}
            />
          </div>

          <p className="text-xs text-muted-foreground">{t('publish_hint')}</p>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`errors.${error}`)}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('save')}
            </Button>
            {saved && !pending ? (
              <span className="text-sm text-misterfc-green">{t('saved')}</span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
