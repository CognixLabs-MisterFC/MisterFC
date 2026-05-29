'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { deleteEvent } from '../actions';

type Props = {
  eventId: string;
  /** Si pertenece a una serie (parent existe o el propio evento es parent). */
  isRecurring: boolean;
  onDeleted?: () => void;
};

type Mode = 'single' | 'this_and_future' | 'series';

export function EventDeleteDialog({ eventId, isRecurring, onDeleted }: Props) {
  const t = useTranslations('calendario.delete');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('single');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await deleteEvent(eventId, mode);
      if (!result.success) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setOpen(false);
      onDeleted?.();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="size-4" aria-hidden />
          <span>{t('trigger')}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>

        {isRecurring && (
          <div className="flex flex-col gap-2 py-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('mode.label')}
            </Label>
            {(['single', 'this_and_future', 'series'] as const).map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name="delete-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="mt-0.5"
                />
                <div className="flex flex-col">
                  <span className="font-medium">{t(`mode.${m}.label`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`mode.${m}.help`)}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              run();
            }}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            <span>{t('confirm')}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
