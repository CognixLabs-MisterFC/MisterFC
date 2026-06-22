'use client';

/**
 * F13.4 — Borrar una jugada con CONFIRMACIÓN (mismo patrón AlertDialog que el
 * resto de la app, p.ej. plantillas/category-delete-button). El gate real es la
 * RLS (autor∪admin/coord); aquí solo se invoca la server action `deletePlay`
 * (13.2a) y se mapea el error a un mensaje.
 *
 *  - `compact` → trigger de icono (acción por fila en el listado).
 *  - `redirectToList` → tras borrar, navega a /jugadas (uso desde el editor);
 *    si no, refresca la ruta actual (uso en el listado).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
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
import { deletePlay } from '../actions';

type Props = {
  playId: string;
  playName: string | null;
  compact?: boolean;
  redirectToList?: boolean;
};

export function PlayDeleteButton({ playId, playName, compact = false, redirectToList = false }: Props) {
  const t = useTranslations('jugadas');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = playName ?? t('untitled');

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await deletePlay({ id: playId });
      if (!res.success) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setOpen(false);
      if (redirectToList) router.push('/jugadas');
      else router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" aria-label={t('delete.action')}>
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant="outline">
            <Trash2 className="size-4 text-destructive" aria-hidden />
            {t('delete.action')}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('delete.description', { name: label })}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('delete.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('delete.action')}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
