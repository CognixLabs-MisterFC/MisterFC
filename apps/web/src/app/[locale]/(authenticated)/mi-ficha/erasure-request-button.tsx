'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldAlert } from 'lucide-react';
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
import { requestPlayerErasure } from './erasure-actions';

/**
 * F14-7 — botón del TUTOR para solicitar la supresión de su hijo. Confirmación
 * clara e irreversible: al aprobarse se borran foto y datos médicos. La aprobación
 * la hace admin_club/director; aquí solo se crea la solicitud.
 */
export function ErasureRequestButton({ playerId }: { playerId: string }) {
  const t = useTranslations('erasure');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');

  function onConfirm() {
    setState('idle');
    startTransition(async () => {
      const res = await requestPlayerErasure(playerId, reason);
      if (res.success) {
        setOpen(false);
        setState('sent');
      } else {
        setState('error');
      }
    });
  }

  if (state === 'sent') {
    return (
      <p className="text-sm text-misterfc-green" role="status">
        {t('request_sent')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-fit border-destructive/50 text-destructive">
            <ShieldAlert className="size-4" aria-hidden />
            <span>{t('request_button')}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('request_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('request_warning')}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('request_reason_placeholder')}
            className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-misterfc-green"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('request_confirm')}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state === 'error' && (
        <p className="text-sm text-destructive" role="alert">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
