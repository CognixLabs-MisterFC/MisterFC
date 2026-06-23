'use client';

/**
 * F13.10b-2 — Una fila de objetivo: muestra título + estado + descripción, con
 * editar (despliega el form) y borrar (confirm + acción). Diseño deliberadamente
 * sobrio: el pulido visual del informe es un paso aparte.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ObjectiveForm } from './objective-form';
import { deleteObjective } from '../actions';
import type { ObjectiveRow } from '../queries';

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-muted text-muted-foreground',
  achieved: 'bg-misterfc-green/15 text-misterfc-green',
  dropped: 'bg-destructive/15 text-destructive',
};

export function ObjectiveItem({
  kind,
  item,
  playerId,
  teamId,
  seasonId,
}: {
  kind: 'player' | 'team';
  item: ObjectiveRow;
  playerId: string;
  teamId: string;
  seasonId: string;
}) {
  const t = useTranslations('informes');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

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
          <span className="break-words">{item.title}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[item.status] ?? ''}`}>
            {t(`status.${item.status}`)}
          </span>
        </p>
        {item.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
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
