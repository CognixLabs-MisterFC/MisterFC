'use client';

/**
 * JR-1 (ADR-0019) — Acciones de ciclo de vida en la CABECERA del editor de jugada
 * (mirror de ExerciseActions, F11.6/11.7). Cada acción se muestra solo a quien
 * puede ejecutarla (autor/aprobador × estado); la RLS/trigger de JR-0 es el gate
 * real. El rechazo y el archivado piden confirmación; el rechazo exige motivo.
 *
 * NOTA (Regla #11): estas acciones operan sobre el estado PERSISTIDO de la jugada
 * (cambian solo el status, no el contenido). El contenido (frames/cabecera) se
 * guarda con el botón "Guardar" del editor. Tras una transición, se refresca.
 */

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Send, Archive, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import type { MethodologyStatus } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { proposePlay, reproposePlay, approvePlay, rejectPlay, archivePlay } from '../actions';

type Props = {
  id: string;
  status: MethodologyStatus;
  archived: boolean;
  isOwner: boolean;
  isApprover: boolean;
};

export function PlayCycleActions({ id, status, archived, isOwner, isApprover }: Props) {
  const t = useTranslations('jugadas');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Quién puede qué (mirror de la RLS/trigger de JR-0).
  const canPropose = isOwner && status === 'draft';
  const canRepropose = isOwner && status === 'rejected';
  // El aprobador puede publicar directo su propio borrador (draft→published).
  const canPublishDraft = isApprover && status === 'draft';
  // Cola de revisión: aprobar/rechazar una propuesta.
  const canReview = isApprover && status === 'proposed';
  const canArchive = isApprover && status === 'published' && !archived;

  if (!canPropose && !canRepropose && !canPublishDraft && !canReview && !canArchive) return null;

  function run(
    fn: () => Promise<{ error?: string; success?: boolean }>,
    okMsg: string,
    after: () => void,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(okMsg);
      after();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReview && (
        <>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => approvePlay({ id }, locale), t('toast.approved'), () => router.refresh())
            }
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {t('actions.approve')}
          </Button>
          <RejectDialog
            disabled={pending}
            labels={{
              trigger: t('actions.reject'),
              title: t('confirm.reject_title'),
              description: t('confirm.reject_desc'),
              reasonLabel: t('confirm.reject_reason_label'),
              reasonPlaceholder: t('confirm.reject_reason_placeholder'),
              cancel: t('confirm.cancel'),
              confirm: t('actions.reject'),
            }}
            onConfirm={(reason) =>
              run(() => rejectPlay({ id, reason }, locale), t('toast.rejected'), () =>
                router.refresh(),
              )
            }
          />
        </>
      )}

      {canPublishDraft && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => approvePlay({ id }, locale), t('toast.approved'), () => router.refresh())
          }
        >
          <CheckCircle2 className="size-4" aria-hidden />
          {t('actions.publish')}
        </Button>
      )}

      {canPropose && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => proposePlay({ id }), t('toast.proposed'), () => router.refresh())
          }
        >
          <Send className="size-4" aria-hidden />
          {t('actions.propose')}
        </Button>
      )}

      {canRepropose && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => reproposePlay({ id }), t('toast.proposed'), () => router.refresh())
          }
        >
          <RotateCcw className="size-4" aria-hidden />
          {t('actions.repropose')}
        </Button>
      )}

      {canArchive && (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm" disabled={pending}>
              <Archive className="size-4" aria-hidden />
              {t('actions.archive')}
            </Button>
          }
          title={t('confirm.archive_title')}
          description={t('confirm.archive_desc')}
          cancel={t('confirm.cancel')}
          confirm={t('confirm.confirm_archive')}
          onConfirm={() =>
            run(() => archivePlay({ id }), t('toast.archived'), () => router.refresh())
          }
        />
      )}
    </div>
  );
}

function RejectDialog({
  disabled,
  labels,
  onConfirm,
}: {
  disabled: boolean;
  labels: {
    trigger: string;
    title: string;
    description: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    cancel: string;
    confirm: string;
  };
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const empty = reason.trim().length === 0;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setReason('');
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <XCircle className="size-4 text-destructive" aria-hidden />
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-reason">{labels.reasonLabel}</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={labels.reasonPlaceholder}
            aria-invalid={empty}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={empty}
            className="bg-destructive text-destructive-foreground"
            onClick={() => {
              setOpen(false);
              onConfirm(reason.trim());
            }}
          >
            {labels.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmAction({
  trigger,
  title,
  description,
  cancel,
  confirm,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
