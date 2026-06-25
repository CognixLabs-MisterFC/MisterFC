'use client';

/**
 * F13.10b-2 — Form de alta/edición de un objetivo (individual o grupal). Llama a
 * la server action en una transición (patrón play-delete-button) y refresca al
 * terminar. created_period es inmutable: en edición va como hidden; en alta es
 * un selector. Los grupales no tienen periodo.
 */

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { OBJECTIVE_STATUSES, DEVELOPMENT_PERIODS } from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  upsertPlayerObjective,
  upsertTeamObjective,
  type ObjectiveState,
} from '../actions';
import type { ObjectiveRow } from '../queries';

const SELECT_CLASS =
  'rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60';

export function ObjectiveForm({
  kind,
  playerId,
  teamId,
  seasonId,
  initial,
  onClose,
}: {
  kind: 'player' | 'team';
  playerId: string;
  teamId: string;
  seasonId: string;
  initial: ObjectiveRow | null;
  onClose: () => void;
}) {
  const t = useTranslations('informes');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ObjectiveState['error'] | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const action = kind === 'team' ? upsertTeamObjective : upsertPlayerObjective;
      const res = await action({}, fd);
      if (res.error) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border p-3">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="player_id" value={playerId} />
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="season_id" value={seasonId} />

      <div className="flex flex-col gap-1">
        <Label htmlFor="obj-title">{t('objective_title')}</Label>
        <Input
          id="obj-title"
          name="title"
          required
          maxLength={200}
          defaultValue={initial?.title ?? ''}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="obj-desc">{t('objective_description')}</Label>
        <Textarea
          id="obj-desc"
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={initial?.description ?? ''}
          placeholder={t('objective_description_hint')}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="obj-review">{t('objective_review')}</Label>
        <Textarea
          id="obj-review"
          name="review_comment"
          rows={2}
          maxLength={2000}
          defaultValue={initial?.review_comment ?? ''}
          placeholder={t('objective_review_hint')}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="obj-status">{t('objective_status')}</Label>
          <select
            id="obj-status"
            name="status"
            defaultValue={initial?.status ?? 'open'}
            className={SELECT_CLASS}
          >
            {OBJECTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {initial ? (
          <input
            type="hidden"
            name="created_period"
            value={initial.created_period ?? 'inicial'}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="obj-period">{t('objective_created_period')}</Label>
            <select id="obj-period" name="created_period" defaultValue="inicial" className={SELECT_CLASS}>
              {DEVELOPMENT_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`period.${p}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
