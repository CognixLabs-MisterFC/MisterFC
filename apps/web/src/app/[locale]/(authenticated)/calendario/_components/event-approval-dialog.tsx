'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Check, X, Clock } from 'lucide-react';
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
import { decideEventApproval } from '../actions';
import type { CalendarEvent } from '../queries';

type Props = {
  event: CalendarEvent;
  /** Solo dirección/admin puede aprobar/rechazar. */
  canApprove: boolean;
  onDone?: () => void;
};

/**
 * F14F-4 — controles de APROBACIÓN de un training creado en día festivo.
 *  · pending + canApprove → botones Aprobar / Rechazar (motivo obligatorio).
 *  · pending sin permiso   → nota "pendiente de aprobación".
 *  · rejected              → nota con el motivo del rechazo.
 * Solo se renderiza algo si el evento tiene approval_status (los normales, null,
 * no muestran nada → cero ruido).
 */
export function EventApprovalControls({ event, canApprove, onDone }: Props) {
  const t = useTranslations('calendario.approval');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pendingTx, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const status = event.approval_status;
  if (status == null || status === 'approved') return null;

  function run(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideEventApproval(
        event.id,
        approve,
        approve ? null : reason.trim() || null,
      );
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setOpen(false);
      onDone?.();
    });
  }

  // RECHAZADO: nota con el motivo (lo ve el creador/staff/dirección).
  if (status === 'rejected') {
    return (
      <span className="text-xs text-destructive">
        {t('rejected_note', { reason: event.rejection_reason ?? '' })}
      </span>
    );
  }

  // PENDIENTE sin permiso de aprobar → solo informa.
  if (!canApprove) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <Clock className="size-3.5" aria-hidden />
        {t('pending_note')}
      </span>
    );
  }

  // PENDIENTE + dirección → aprobar / rechazar.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => run(true)}
          disabled={pendingTx}
        >
          {pendingTx ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          <span>{t('approve')}</span>
        </Button>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={pendingTx}
            >
              <X className="size-4" aria-hidden />
              <span>{t('reject')}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('reject_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('reject_description')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2 py-1">
              <Label htmlFor="reject-reason" className="text-sm">
                {t('reason_label')}
              </Label>
              <textarea
                id="reject-reason"
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
              <AlertDialogCancel disabled={pendingTx}>
                {t('back')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  run(false);
                }}
                disabled={pendingTx || reason.trim().length === 0}
              >
                {pendingTx && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                <span>{t('reject')}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && !open && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
