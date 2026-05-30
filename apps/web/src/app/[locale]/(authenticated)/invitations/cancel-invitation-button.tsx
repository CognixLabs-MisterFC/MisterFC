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
import { cancelInvitation, type CancelInvitationResult } from './actions';

type Props = {
  locale: string;
  invitationId: string;
  email: string;
  /**
   * Cuando el server responde OK, ocultamos la fila. El padre puede pasar un
   * `onCancelled` para limpieza adicional (ej. animación, contador). Si el
   * server falla, restauramos visibilidad y mostramos el error inline. Sin
   * router.refresh manual: ya hacemos `revalidatePath` server-side.
   */
  onCancelled?: () => void;
};

/**
 * Botón "Cancelar invitación" para una fila pendiente o expirada.
 *
 * Se monta junto a cada fila de invitación en las 3 vistas (club, equipo,
 * jugador). El botón abre un AlertDialog de confirmación; al aceptar, llama
 * a `cancelInvitation` que ejecuta DELETE bajo `invitations_delete_managers`.
 *
 * Optimistic UI: en cuanto el user confirma, ocultamos la fila vía estado
 * local `hidden`. Si el server falla, restauramos la fila y enseñamos el
 * error. Los errores conocidos vienen de `cancelInvitation.error` y tienen
 * traducción en `invitations.cancel.errors.*`.
 */
export function CancelInvitationButton({
  locale,
  invitationId,
  email,
  onCancelled,
}: Props) {
  const t = useTranslations('invitations.cancel');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<CancelInvitationResult['error'] | null>(
    null,
  );

  if (hidden && !error) return null;

  function onConfirm() {
    setError(null);
    setHidden(true);
    setOpen(false);
    startTransition(async () => {
      const res = await cancelInvitation(locale, invitationId);
      if (res.ok) {
        onCancelled?.();
        return;
      }
      // Rollback optimista — la fila vuelve a aparecer con el error.
      setHidden(false);
      setError(res.error ?? 'generic');
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {t(`errors.${error}`)}
        </span>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('action')}
            title={t('action')}
            className="text-destructive hover:text-destructive"
            disabled={pending}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirm.description', { email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('confirm.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
