'use client';

/**
 * F13.10b-2 — Una fila de objetivo: muestra título + estado + descripción, con
 * editar (despliega el form) y borrar (confirm + acción). Diseño deliberadamente
 * sobrio: el pulido visual del informe es un paso aparte.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { objectiveDisplayState } from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { OBJ_STATE_CLASS } from '@/lib/objective-display';
import { Button } from '@/components/ui/button';
import { ObjectiveForm } from './objective-form';
import { deleteObjective } from '../actions';
import type { ObjectiveRow } from '../queries';

export function ObjectiveItem({
  kind,
  item,
  playerId,
  teamId,
  seasonId,
  period,
}: {
  kind: 'player' | 'team';
  item: ObjectiveRow;
  playerId: string;
  teamId: string;
  seasonId: string;
  /** Periodo del informe que se está editando: deriva el estado mostrado. */
  period: string;
}) {
  const t = useTranslations('informes');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const state = objectiveDisplayState(item.status, item.created_period, period);

  if (editing) {
    return (
      <ObjectiveForm
        kind={kind}
        playerId={playerId}
        teamId={teamId}
        seasonId={seasonId}
        initial={item}
        onClose={() => setEditing(false)}
      />
    );
  }

  const onDelete = () => {
    if (!window.confirm(t('confirm_delete'))) return;
    const fd = new FormData();
    fd.set('id', item.id);
    fd.set('kind', kind);
    fd.set('player_id', playerId);
    start(async () => {
      await deleteObjective({}, fd);
      router.refresh();
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className={cn('break-words', state === 'descartado' && 'line-through opacity-80')}>
            {item.title}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
              OBJ_STATE_CLASS[state],
            )}
          >
            {t(`obj_state.${state}`)}
          </span>
        </p>
        {item.description ? (
          <p className="mt-1 text-sm">
            <span className="font-medium text-foreground">{t('objective_description')}: </span>
            <span className="text-muted-foreground">{item.description}</span>
          </p>
        ) : null}
        {item.review_comment ? (
          <p className="mt-1 text-sm">
            <span className="font-medium text-foreground">{t('objective_review')}: </span>
            <span className="text-muted-foreground">{item.review_comment}</span>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onDelete}
          disabled={pending}
          aria-label={t('delete')}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
