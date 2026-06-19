'use client';

/**
 * F11.6/11.7 — Acciones de ciclo de vida en la ficha del ejercicio. Cada acción
 * se muestra solo a quien puede ejecutarla (autor/Admin × estado); la RLS/trigger
 * de 11.1 es el gate real. Destructivas (borrar/archivar) y el rechazo piden
 * confirmación; el rechazo además exige motivo.
 */

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Send, Trash2, Archive, CheckCircle2, XCircle } from 'lucide-react';
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
import { Link, useRouter } from '@/i18n/navigation';
import {
  proposeExercise,
  deleteExercise,
  archiveExercise,
  approveExercise,
  rejectExercise,
} from '../actions';

type Props = {
  id: string;
  status: MethodologyStatus;
  isOwner: boolean;
  isAdmin: boolean;
};

export function ExerciseActions({ id, status, isOwner, isAdmin }: Props) {
  const t = useTranslations('ejercicios');
  const tForm = useTranslations('ejercicios.form');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Quién puede qué (mirror de la política de 11.1 + 12.7a).
  // Autor: sus draft/proposed/rejected. Admin (dueño de la metodología): además los
  // propuestos y publicados del club (para ajustar la biblioteca, p.ej. la fase).
  const canEdit =
    (isOwner && (status === 'draft' || status === 'proposed' || status === 'rejected')) ||
    (isAdmin && (status === 'proposed' || status === 'published'));
  const canPropose = isOwner && status === 'draft';
  const canDelete =
    (isOwner && (status === 'draft' || status === 'proposed' || status === 'rejected')) ||
    (isAdmin && status !== 'published');
  const canArchive = isAdmin && status === 'published';
  // 11.7 — el Admin revisa los propuestos.
  const canReview = isAdmin && status === 'proposed';

  if (!canEdit && !canPropose && !canDelete && !canArchive && !canReview) return null;

  function run(
    fn: () => Promise<{ error?: string; success?: boolean }>,
    okMsg: string,
    after: () => void
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(tForm(`errors.${res.error}`));
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
              run(() => approveExercise({ id }), t('toast.approved'), () => router.refresh())
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
              run(() => rejectExercise({ id, reason }, locale), t('toast.rejected'), () =>
                router.refresh()
              )
            }
          />
        </>
      )}

      {canEdit && (
        <Button asChild variant="outline" size="sm">
          <Link href={`/ejercicios/${id}/editar`}>
            <Pencil className="size-4" aria-hidden />
            {status === 'rejected' ? t('actions.edit_repropose') : t('actions.edit')}
          </Link>
        </Button>
      )}

      {canPropose && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => proposeExercise({ id }), t('toast.proposed'), () => router.refresh())
          }
        >
          <Send className="size-4" aria-hidden />
          {t('actions.propose')}
        </Button>
      )}

      {canDelete && (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm" disabled={pending}>
              <Trash2 className="size-4 text-destructive" aria-hidden />
              {t('actions.delete')}
            </Button>
          }
          title={t('confirm.delete_title')}
          description={t('confirm.delete_desc')}
          cancel={t('confirm.cancel')}
          confirm={t('confirm.confirm_delete')}
          destructive
          onConfirm={() =>
            run(() => deleteExercise({ id }), t('toast.deleted'), () =>
              router.push('/ejercicios')
            )
          }
        />
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
            run(() => archiveExercise({ id }), t('toast.archived'), () =>
              router.push('/ejercicios')
            )
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
  destructive = false,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  destructive?: boolean;
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
            className={destructive ? 'bg-destructive text-destructive-foreground' : undefined}
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
