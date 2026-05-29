'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CALLUP_RESPONSE_STATUSES, type CallupResponseStatus } from '@misterfc/core';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { upsertCallupResponse } from '../actions';

const STATUS_COLOR: Record<CallupResponseStatus, string> = {
  yes: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700',
  maybe: 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600',
  no: 'bg-red-600 text-white border-red-600 hover:bg-red-700',
};

type Props = {
  eventId: string;
  playerId: string;
  initial: CallupResponseStatus | null;
  initialReason: string | null;
  disabled?: boolean;
};

export function ResponseButtons({
  eventId,
  playerId,
  initial,
  initialReason,
  disabled = false,
}: Props) {
  const t = useTranslations('convocatorias.response');
  const [optimistic, setOptimistic] =
    useState<CallupResponseStatus | null>(initial);
  const [reason, setReason] = useState(initialReason ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(initialReason != null);

  function apply(status: CallupResponseStatus) {
    if (disabled) return;
    setError(null);
    const prev = optimistic;
    setOptimistic(status);
    startTransition(async () => {
      const r = await upsertCallupResponse({
        event_id: eventId,
        player_id: playerId,
        status,
        reason: reason || null,
      });
      if (r.error) {
        setOptimistic(prev);
        setError(r.error);
      }
    });
  }

  function saveReason() {
    if (disabled || optimistic == null) return;
    setError(null);
    startTransition(async () => {
      const r = await upsertCallupResponse({
        event_id: eventId,
        player_id: playerId,
        status: optimistic,
        reason: reason || null,
      });
      if (r.error) setError(r.error);
      else setShowReason(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex gap-1.5"
        role="radiogroup"
        aria-label={t('group_label')}
      >
        {CALLUP_RESPONSE_STATUSES.map((status) => {
          const active = optimistic === status;
          return (
            <Button
              key={status}
              type="button"
              size="sm"
              variant="outline"
              role="radio"
              aria-checked={active}
              aria-label={t(status)}
              onClick={() => apply(status)}
              disabled={disabled || pending}
              className={cn(
                'h-8 min-w-20 justify-center',
                active && STATUS_COLOR[status]
              )}
            >
              {pending && active && (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              )}
              <span>{t(status)}</span>
            </Button>
          );
        })}
      </div>

      {optimistic != null && (
        <div className="flex items-start gap-2">
          {showReason ? (
            <>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t('reason_placeholder')}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={saveReason}
                disabled={disabled || pending}
              >
                {t('save_reason')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowReason(true)}
              className="h-7 text-xs"
            >
              {reason ? t('edit_reason') : t('add_reason')}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}
    </div>
  );
}
