'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
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
import { openNextSeason } from './actions';

/**
 * Rework C · C6 — botón "Abrir temporada {label}". Crea/reanuda la temporada
 * upcoming + clona los equipos de la activa (idempotente, server-side) y navega
 * a esa temporada para revisarla. Solo se muestra a admin_club cuando aún no hay
 * upcoming.
 *
 * C10 — antes de ejecutar la apertura se pide confirmación en un AlertDialog
 * (crear temporada nueva + clonar equipos no es trivial). Solo al confirmar se
 * llama a openNextSeason.
 */
export function OpenSeasonButton({ nextLabel }: { nextLabel: string }) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await openNextSeason();
      if (result.ok) {
        setOpen(false);
        router.push(`/equipos?season=${result.ok.season}`);
      } else {
        setError(t(`open_season_error.${result.error ?? 'generic'}`));
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline">
            <CalendarPlus className="size-4" aria-hidden />
            <span>{t('open_season', { season: nextLabel })}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('open_season_confirm_title', { season: nextLabel })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('open_season_confirm_description', { season: nextLabel })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('open_season_confirm_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('open_season_confirm_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
