'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, CalendarOff, Plus } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { markHoliday, unmarkHoliday } from '../actions';
import type { HolidayInfo } from '../queries';

type Props = {
  /** 'YYYY-MM-DD' (día local del club). */
  dateIso: string;
  /** El festivo de este día, o null si no lo es. */
  holiday: HolidayInfo | null;
  /** Solo dirección/admin puede marcar/desmarcar. */
  canManage: boolean;
};

/**
 * F14F-2 — marcador y control de DÍA FESTIVO en el calendario.
 *  · Si el día es festivo → badge "Festivo" (con el motivo) VISIBLE PARA TODOS.
 *    Para dirección/admin el badge abre el diálogo de DESMARCAR.
 *  · Si no es festivo y el usuario es dirección/admin → botón sutil para MARCAR.
 *  · Si no es festivo y no gestiona → no renderiza nada.
 */
export function HolidayCell({ dateIso, holiday, canManage }: Props) {
  const t = useTranslations('calendario.holidays');
  const [markOpen, setMarkOpen] = useState(false);
  const [unmarkOpen, setUnmarkOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runMark() {
    setError(null);
    startTransition(async () => {
      const res = await markHoliday(dateIso, reason.trim());
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setReason('');
      setMarkOpen(false);
    });
  }

  function runUnmark() {
    if (!holiday) return;
    setError(null);
    startTransition(async () => {
      const res = await unmarkHoliday(holiday.id);
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setUnmarkOpen(false);
    });
  }

  // Badge de festivo (todos los roles). Estilo ámbar para distinguirlo del rojo
  // de "cancelado por persona".
  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 text-[9px] font-semibold uppercase',
        'bg-amber-500/15 text-amber-700 dark:text-amber-400'
      )}
      title={holiday?.reason}
    >
      <CalendarOff className="size-3" aria-hidden />
      {t('badge')}
    </span>
  );

  if (holiday) {
    // No gestiona: solo el marcador informativo.
    if (!canManage) return badge;
    // Gestiona: el badge abre el diálogo de desmarcar.
    return (
      <AlertDialog open={unmarkOpen} onOpenChange={setUnmarkOpen}>
        <AlertDialogTrigger asChild>
          <button type="button" className="cursor-pointer" aria-label={t('unmark')}>
            {badge}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unmark_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unmark_description', { reason: holiday.reason })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runUnmark();
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('unmark')}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // No es festivo. Solo dirección/admin ve el botón de marcar (sutil, hover).
  if (!canManage) return null;

  return (
    <AlertDialog open={markOpen} onOpenChange={setMarkOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 group-hover:opacity-100"
          aria-label={t('trigger')}
          title={t('trigger')}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2 py-1">
          <Label htmlFor="holiday-reason" className="text-sm">
            {t('reason_label')}
          </Label>
          <input
            id="holiday-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={100}
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
          <AlertDialogCancel disabled={pending}>{t('back')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              runMark();
            }}
            disabled={pending || reason.trim().length === 0}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('confirm')}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
