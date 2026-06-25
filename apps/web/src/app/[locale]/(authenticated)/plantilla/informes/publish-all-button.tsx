'use client';

/**
 * F13.10g-GC — "Publicar todo": publica en masa los informes COMPLETOS del periodo
 * a las familias (RPC publish_campaign). Solo admin, visible con la campaña
 * 'launched'. Confirmación con el recuento (cuántos se publican / cuántos quedan
 * sin publicar por incompletos).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Megaphone, Loader2 } from 'lucide-react';
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
import { publishCampaign } from './actions';

type Props = {
  seasonId: string;
  period: string;
  locale: string;
  completed: number;
  pending: number;
};

export function PublishAllButton({ seasonId, period, locale, completed, pending }: Props) {
  const t = useTranslations('informes.campaign');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [working, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await publishCampaign({ season_id: seasonId, period, locale });
      if (res.error) {
        setError(t(`error.${res.error}`));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="default">
          <Megaphone className="size-4" aria-hidden />
          <span>{t('publish_all')}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('publish_all_confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('publish_all_confirm_body', { done: completed, pending })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>{t('publish_all_cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={working}
          >
            {working && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('publish_all_confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
