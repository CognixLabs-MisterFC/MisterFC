'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { UserMinus, UserCheck, Loader2 } from 'lucide-react';
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
import { setPlayerLeftClub } from '../actions';

type Props = {
  playerId: string;
  playerName: string;
  isLeftClub: boolean;
};

/**
 * Rework C · C11a — baja / reactivar de un jugador. No destructivo: solo cambia
 * players.left_club_at (la acción de servidor). La baja pide confirmación y una
 * razón opcional; reactivar también confirma. Reversible.
 */
export function PlayerBajaButton({ playerId, playerName, isLeftClub }: Props) {
  const t = useTranslations('jugadores.baja');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await setPlayerLeftClub(playerId, {
        reactivate: isLeftClub,
        reason: isLeftClub ? undefined : reason,
      });
      if (res.ok) {
        setOpen(false);
        setReason('');
      } else {
        setError(t(`error.${res.error ?? 'generic'}`));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={isLeftClub ? t('reactivate_action') : t('action')}
          className={isLeftClub ? '' : 'text-destructive hover:text-destructive'}
        >
          {isLeftClub ? (
            <UserCheck className="size-4" aria-hidden />
          ) : (
            <UserMinus className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">
            {isLeftClub ? t('reactivate_action') : t('action')}
          </span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isLeftClub ? t('reactivate_title') : t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isLeftClub
              ? t('reactivate_description', { name: playerName })
              : t('description', { name: playerName })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!isLeftClub && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`reason-${playerId}`}>{t('reason_label')}</Label>
            <input
              id={`reason-${playerId}`}
              type="text"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reason_placeholder')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isLeftClub ? t('reactivate_confirm') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
