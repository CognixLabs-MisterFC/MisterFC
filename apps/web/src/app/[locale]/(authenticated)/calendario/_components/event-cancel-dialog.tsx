'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Ban, RotateCcw } from 'lucide-react';
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
import { cancelTraining, uncancelTraining } from '../actions';
import type { CalendarEvent } from '../queries';

type Props = {
  event: CalendarEvent;
  onDone?: () => void;
};

/**
 * F14F-1 — Controles de CANCELAR / REACTIVAR un entrenamiento. Se muestra solo a
 * quien gestiona el evento (el diálogo lo gatea con canManage). Un entrenamiento
 * cancelado NO desaparece: aquí se reactiva (solo si lo canceló una PERSONA; lo
 * cancelado por un festivo se reactiva en F14F-2).
 */
export function EventCancelControls({ event, onDone }: Props) {
  const t = useTranslations('calendario.cancel');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isCancelled = event.cancelled_at != null;
  const byHoliday = event.cancellation_source === 'holiday';

  function runCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelTraining(event.id, reason.trim() || null);
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setOpen(false);
      onDone?.();
    });
  }

  function runUncancel() {
    setError(null);
    startTransition(async () => {
      const res = await uncancelTraining(event.id);
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      onDone?.();
    });
  }

  // Cancelado por un festivo: en F14F-1 no se reactiva desde aquí (lo hace F14F-2
  // al desmarcar el festivo). Se informa, sin acción.
  if (isCancelled && byHoliday) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('by_holiday_note')}
      </span>
    );
  }

  if (isCancelled) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runUncancel}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="size-4" aria-hidden />
          )}
          <span>{t('reactivate')}</span>
        </Button>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="text-destructive">
            <Ban className="size-4" aria-hidden />
            <span>{t('trigger')}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('description')}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 py-1">
            <Label htmlFor="cancel-reason" className="text-sm">
              {t('reason_label')}
            </Label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={t('reason_placeholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('back')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runCancel();
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('confirm')}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
