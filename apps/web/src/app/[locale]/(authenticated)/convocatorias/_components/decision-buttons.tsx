'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  CALLUP_DECISION_KINDS,
  type CallupDecisionKind,
} from '@misterfc/core';
import { Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clearCallupDecision, upsertCallupDecision } from '../actions';

const DECISION_COLOR: Record<CallupDecisionKind, string> = {
  called_up:
    'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700',
  discarded: 'bg-zinc-700 text-white border-zinc-700 hover:bg-zinc-800',
};

type Props = {
  eventId: string;
  playerId: string;
  initial: CallupDecisionKind | null;
  initialReason: string | null;
  disabled?: boolean;
};

export function DecisionButtons({
  eventId,
  playerId,
  initial,
  initialReason,
  disabled = false,
}: Props) {
  const t = useTranslations('convocatorias.decision');
  const [optimistic, setOptimistic] =
    useState<CallupDecisionKind | null>(initial);
  const [reason, setReason] = useState(initialReason ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(initialReason != null);

  function apply(decision: CallupDecisionKind) {
    if (disabled) return;
    setError(null);
    const prev = optimistic;
    setOptimistic(decision);
    startTransition(async () => {
      const r = await upsertCallupDecision({
        event_id: eventId,
        player_id: playerId,
        decision,
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
      const r = await upsertCallupDecision({
        event_id: eventId,
        player_id: playerId,
        decision: optimistic,
        reason: reason || null,
      });
      if (r.error) setError(r.error);
      else setShowReason(false);
    });
  }

  function clear() {
    if (disabled) return;
    setError(null);
    const prev = optimistic;
    setOptimistic(null);
    startTransition(async () => {
      const r = await clearCallupDecision(eventId, playerId);
      if (r.error) {
        setOptimistic(prev);
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex gap-1.5"
        role="radiogroup"
        aria-label={t('group_label')}
      >
        {CALLUP_DECISION_KINDS.map((decision) => {
          const active = optimistic === decision;
          return (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant="outline"
              role="radio"
              aria-checked={active}
              aria-label={t(decision)}
              onClick={() => apply(decision)}
              disabled={disabled || pending}
              className={cn(
                'h-7 min-w-24 justify-center',
                active && DECISION_COLOR[decision]
              )}
            >
              {pending && active && (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              )}
              <span>{t(decision)}</span>
            </Button>
          );
        })}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={clear}
          disabled={disabled || pending || optimistic == null}
          aria-label={t('clear')}
          title={t('clear')}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          <Undo2 className="size-3.5" aria-hidden />
        </Button>
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
              className="h-6 text-xs"
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
