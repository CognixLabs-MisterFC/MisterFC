'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { decideErasure } from './actions';

/**
 * F14-7 — botones Aprobar / Rechazar de una solicitud de supresión (bandeja de
 * admin_club/director). Aprobar es irreversible (borra foto y médica); se pide
 * confirmación en dos pasos.
 */
export function DecisionButtons({ requestId }: { requestId: string }) {
  const t = useTranslations('erasure');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideErasure(requestId, approve, null);
      if (res.error) setError(t(`errors.${res.error}`));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => decide(false)}
        >
          <X className="size-4" aria-hidden />
          <span>{t('reject')}</span>
        </Button>
        {confirmApprove ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => decide(true)}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            <span>{t('approve_confirm')}</span>
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => setConfirmApprove(true)}>
            <Check className="size-4" aria-hidden />
            <span>{t('approve')}</span>
          </Button>
        )}
      </div>
      {confirmApprove && !error && (
        <p className="text-xs text-destructive">{t('approve_warning')}</p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
