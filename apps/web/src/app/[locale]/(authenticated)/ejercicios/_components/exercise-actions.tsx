'use client';

/**
 * F11.6 PR2 — Acciones de ciclo de vida en la ficha del ejercicio. Cada acción se
 * muestra solo a quien puede ejecutarla (autor/Admin × estado); la RLS/trigger de
 * 11.1 es el gate real. Las destructivas (borrar/archivar) piden confirmación.
 * Aprobar/rechazar NO está aquí (es 11.7).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Send, Trash2, Archive } from 'lucide-react';
import type { MethodologyStatus } from '@misterfc/core';
import { Button } from '@/components/ui/button';
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
import { proposeExercise, deleteExercise, archiveExercise } from '../actions';

type Props = {
  id: string;
  status: MethodologyStatus;
  isOwner: boolean;
  isAdmin: boolean;
};

export function ExerciseActions({ id, status, isOwner, isAdmin }: Props) {
  const t = useTranslations('ejercicios');
  const tForm = useTranslations('ejercicios.form');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Quién puede qué (mirror de la política de 11.1).
  const canEdit = isOwner && (status === 'draft' || status === 'proposed');
  const canPropose = isOwner && status === 'draft';
  const canDelete =
    (isOwner && (status === 'draft' || status === 'proposed' || status === 'rejected')) ||
    (isAdmin && status !== 'published');
  const canArchive = isAdmin && status === 'published';

  if (!canEdit && !canPropose && !canDelete && !canArchive) return null;

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
      {canEdit && (
        <Button asChild variant="outline" size="sm">
          <Link href={`/ejercicios/${id}/editar`}>
            <Pencil className="size-4" aria-hidden />
            {t('actions.edit')}
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
