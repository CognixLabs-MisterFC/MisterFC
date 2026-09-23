'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { selfRevokeDoneMessageKey } from '@misterfc/core';
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
import { revokeSelfForPlayer } from '../jugadores/actions';

type Props = {
  playerId: string;
  playerName: string;
  /** 'linked' o 'invited'. Decide la frase de la confirmación, no el permiso. */
  invitedOnly: boolean;
};

/**
 * RC-2 — «Retirar el acceso», con confirmación. Mismo patrón que
 * `RevokeSpectatorButton` (AlertDialog + useTransition + refresh), que es la acción
 * hermana: las dos quitan a alguien de un jugador.
 *
 * QUIÉN VE ESTE BOTÓN lo decide `canOfferSelfRevoke` en la página, no este
 * componente: hacen falta los dos predicados con los que se gatea el SQL (ser tutor y
 * que el jugador sea menor), y el estado por sí solo no basta — a un chaval de 18 con
 * su cuenta, `player_self_account_status` le contesta 'linked' igual que a su padre.
 *
 * LA CONFIRMACIÓN DICE LO QUE PASA Y LO QUE NO. Retirar el acceso no da de baja al
 * jugador: sigue en el club, en su equipo y en sus convocatorias. Decirlo aquí es la
 * mitad del trabajo — sin esa frase, «retirar» suena a borrar al niño.
 */
export function RevokeSelfDialog({ playerId, playerName, invitedOnly }: Props) {
  const t = useTranslations('invite_self.revoke');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await revokeSelfForPlayer(playerId);
      if (res.error) {
        setError(t(`errors.${res.error}`));
        return;
      }
      // El resultado dice QUÉ habia: cancelar una invitación que nadie llegó a usar
      // no es lo mismo que quitarle el acceso a quien ya estaba dentro.
      setDone(res.ok ? t(selfRevokeDoneMessageKey(res.ok)) : null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (next) setError(null);
          setOpen(next);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
          >
            {t('action')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(invitedOnly ? 'confirm_invited' : 'confirm', { player: playerName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">{t('keeps_player')}</p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('confirm_action')}</span>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {done && (
        <p className="text-sm text-muted-foreground" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
