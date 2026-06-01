'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2, Pencil } from 'lucide-react';
import type { CoachFormation, TeamFormat } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { FormationBuilder } from './formation-builder';
import { deleteFormation } from '../actions';

const FILTERS: (TeamFormat | 'all')[] = ['all', 'F7', 'F8', 'F11'];

type Props = {
  formations: CoachFormation[];
  canCreate: boolean;
};

type View =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; formation: CoachFormation };

function DeleteButton({ formation }: { formation: CoachFormation }) {
  const t = useTranslations('formaciones');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await deleteFormation({ id: formation.id });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.deleted'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('actions.delete')}>
          <Trash2 className="size-4 text-destructive" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('delete.description', { name: formation.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('actions.delete')}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FormationsManager({ formations, canCreate }: Props) {
  const t = useTranslations('formaciones');
  const [filter, setFilter] = useState<TeamFormat | 'all'>('all');
  const [view, setView] = useState<View>({ mode: 'list' });

  const visible = useMemo(
    () =>
      filter === 'all'
        ? formations
        : formations.filter((f) => f.format === filter),
    [formations, filter],
  );

  if (view.mode === 'create' || view.mode === 'edit') {
    return (
      <Card>
        <CardContent className="pt-6">
          <FormationBuilder
            initial={view.mode === 'edit' ? view.formation : undefined}
            onClose={() => setView({ mode: 'list' })}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? t('filter.all') : f}
            </Button>
          ))}
        </div>
        {canCreate && (
          <Button onClick={() => setView({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            <span>{t('actions.new')}</span>
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {canCreate ? t('empty') : t('empty_no_permission')}
          </p>
          {canCreate && (
            <Button onClick={() => setView({ mode: 'create' })}>
              <Plus className="size-4" aria-hidden />
              <span>{t('actions.create_first')}</span>
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-3 text-left"
                    onClick={() => setView({ mode: 'edit', formation: f })}
                  >
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                      {f.format}
                    </span>
                    <span className="font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('positions_count', { count: f.positions.length })}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('actions.edit')}
                      onClick={() => setView({ mode: 'edit', formation: f })}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <DeleteButton formation={f} />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
