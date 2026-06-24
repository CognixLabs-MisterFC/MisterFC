'use client';

/**
 * F13.10g-GB — Controles de la campaña de un periodo: fija la fecha límite (admin)
 * y la LANZA (draft→launched, avisa a entrenadores). Coord lo ve deshabilitado.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Megaphone, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCampaignDeadline, launchCampaign } from './actions';

type Props = {
  seasonId: string;
  period: string;
  locale: string;
  initialDueDate: string; // 'YYYY-MM-DD' | ''
  status: 'draft' | 'launched' | 'published';
  canEdit: boolean;
};

export function LaunchControls({ seasonId, period, locale, initialDueDate, status, canEdit }: Props) {
  const t = useTranslations('informes.campaign');
  const router = useRouter();
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [saving, startSave] = useTransition();
  const [launching, startLaunch] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = status === 'draft';

  function onDateChange(next: string) {
    const prev = dueDate;
    setDueDate(next);
    setError(null);
    setSaved(false);
    startSave(async () => {
      const res = await setCampaignDeadline({
        season_id: seasonId,
        period,
        due_date: next === '' ? null : next,
      });
      if (res.error) {
        setDueDate(prev);
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    });
  }

  function onLaunch() {
    setError(null);
    startLaunch(async () => {
      const res = await launchCampaign({ season_id: seasonId, period, locale });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('due_date_label')}</span>
          <input
            type="date"
            value={dueDate}
            disabled={!canEdit || saving || !isDraft}
            onChange={(e) => onDateChange(e.target.value)}
            className="rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
          />
          {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />}
          {saved && !saving && (
            <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
        </label>

        {canEdit && isDraft && (
          <Button size="sm" onClick={onLaunch} disabled={launching || dueDate === ''}>
            {launching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Megaphone className="size-4" aria-hidden />
            )}
            <span>{t('launch')}</span>
          </Button>
        )}
      </div>

      {canEdit && isDraft && dueDate === '' && (
        <p className="text-xs text-muted-foreground">{t('launch_hint')}</p>
      )}
      {!canEdit && (
        <p className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
          <Lock className="size-3" aria-hidden /> {t('read_only')}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{t(`error.${error}`)}</p>
      )}
    </div>
  );
}
