'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, TriangleAlert } from 'lucide-react';
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
import { requestAccountDeletion } from './account-deletion-actions';

export type DeletionBlocker = { playerId: string; playerName: string; clubName: string };

/**
 * BC-4 — "Eliminar mi cuenta" (Apple 5.1.1 v). La acción más irreversible que puede
 * lanzar un usuario sobre SÍ MISMO, así que:
 *  · se enseña ANTES de confirmar qué se borra y qué se conserva, sin eufemismos;
 *  · si es el único tutor de algún jugador activo se listan por nombre, porque la misma
 *    pulsación pide su supresión al club;
 *  · la confirmación exige ESCRIBIR una palabra: un clic de más no basta.
 */
export function DeleteAccountCard({
  locale,
  blockers,
}: {
  locale: string;
  blockers: DeletionBlocker[];
}) {
  const t = useTranslations('account_deletion');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmWord = t('confirm_word');
  const canConfirm = typed.trim().toLowerCase() === confirmWord.toLowerCase();

  // Hueco reservado para la suscripción anual (spec BC.0 §8). Apple exige avisar de que
  // borrar la cuenta NO cancela la suscripción. Hoy la clave está VACÍA a propósito en
  // los tres idiomas: no hay suscripción todavía, y no vamos a afirmar algo falso. El
  // día que exista, se rellena y el aviso aparece solo. NO borrar la clave.
  const subscriptionNote = t('subscription_note').trim();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await requestAccountDeletion(null);
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setOpen(false);
      // Completado → pantalla pública de despedida (la sesión ya está cerrada).
      // Con bloqueantes → dead-end con el estado del borrado y el botón de cancelar.
      router.replace(res.completed ? `/${locale}/cuenta-eliminada` : `/${locale}/onboarding`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('card_hint')}</p>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-fit border-destructive/50 text-destructive">
            <TriangleAlert className="size-4" aria-hidden />
            <span>{t('button')}</span>
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialog_intro')}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="font-medium">{t('removed_title')}</p>
              <p className="text-xs text-muted-foreground">{t('removed_body')}</p>
            </div>
            <div>
              <p className="font-medium">{t('kept_title')}</p>
              <p className="text-xs text-muted-foreground">{t('kept_body')}</p>
            </div>

            {blockers.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-900">{t('blockers_title')}</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
                  {blockers.map((b) => (
                    <li key={b.playerId}>
                      {b.playerName} · {b.clubName}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-900">{t('blockers_body')}</p>
              </div>
            )}

            {subscriptionNote.length > 0 && (
              <p className="text-xs text-muted-foreground">{subscriptionNote}</p>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('confirm_label', { word: confirmWord })}
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-destructive"
              />
            </label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
              disabled={pending || !canConfirm}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('confirm')}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
