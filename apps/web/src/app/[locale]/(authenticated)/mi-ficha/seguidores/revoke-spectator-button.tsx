'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { removeSpectatorForPlayer } from '../../jugadores/actions';

type Props = {
  playerId: string;
  spectatorProfileId: string;
  spectatorName: string;
};

/**
 * F14C-5 — Botón "Quitar" un seguidor con confirmación (AlertDialog). Llama a la
 * server action removeSpectatorForPlayer (RPC remove_spectator, gate tutor/self
 * en la DB). Tras revocar, refresca para que el seguidor desaparezca de la lista.
 */
export function RevokeSpectatorButton({
  playerId,
  spectatorProfileId,
  spectatorName,
}: Props) {
  const t = useTranslations('seguidores');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await removeSpectatorForPlayer(playerId, spectatorProfileId);
      if (res.error) {
        setError(t(`revoke.errors.${res.error}`));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          {t('revoke.action')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('revoke.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('revoke.confirm', { name: spectatorName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('revoke.cancel')}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('revoke.confirm_action')}</span>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
