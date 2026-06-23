'use client';

/**
 * F13.10-editor — Editor de la VALORACIÓN DE EQUIPO (team×season×period). Rejilla
 * TEAM_REPORT_CATALOG + comentario de equipo + visibilidad. Guarda vía server
 * action en transición (patrón objective-form) y refresca.
 */

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import {
  TEAM_REPORT_CATALOG,
  DEVELOPMENT_VISIBILITIES,
  DEVELOPMENT_COMMENT_MAX,
} from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGrid } from './score-grid';
import { upsertTeamDevelopmentReport, type ReportState } from '../actions';
import type { TeamReport } from '../queries';

const SELECT_CLASS =
  'rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60';

export function TeamReportEditor({
  teamId,
  seasonId,
  period,
  initial,
}: {
  teamId: string;
  seasonId: string;
  period: string;
  initial: TeamReport | null;
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
      const res = await upsertTeamDevelopmentReport({}, fd);
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
        <CardTitle className="text-base">{t('team_valuation')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="season_id" value={seasonId} />
          <input type="hidden" name="period" value={period} />

          <ScoreGrid catalog={TEAM_REPORT_CATALOG} initial={initial?.scores ?? {}} />

          <div className="flex flex-col gap-1">
            <Label htmlFor="team-comment">{t('team_comment')}</Label>
            <Textarea
              id="team-comment"
              name="comment"
              rows={3}
              maxLength={DEVELOPMENT_COMMENT_MAX}
              defaultValue={initial?.comment ?? ''}
              placeholder={t('comment_placeholder')}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="team-visibility">{t('visibility_label')}</Label>
            <select
              id="team-visibility"
              name="visibility"
              defaultValue={initial?.visibility ?? 'staff'}
              className={SELECT_CLASS}
            >
              {DEVELOPMENT_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`visibility.${v}`)}
                </option>
              ))}
            </select>
          </div>

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
