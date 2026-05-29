'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
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
import { removeStaffAssignment } from '../actions';

type Props = {
  teamStaffId: string;
  membershipId: string;
  teamName: string;
  /** Si true, sólo icono. Útil para tablas. */
  compact?: boolean;
};

export function RemoveAssignmentButton({
  teamStaffId,
  membershipId,
  teamName,
  compact = false,
}: Props) {
  const t = useTranslations('cuerpo_tecnico.remove');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await removeStaffAssignment(teamStaffId, membershipId);
      if (r.success) setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('action')}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            <span>{t('action')}</span>
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('description', { team: teamName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
