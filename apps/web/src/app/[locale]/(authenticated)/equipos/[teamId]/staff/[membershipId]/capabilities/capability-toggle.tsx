'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toggleCapability } from './actions';

type Props = {
  teamId: string;
  membershipId: string;
  capabilityName: string;
  initial: boolean;
  canEdit: boolean;
};

export function CapabilityToggle({
  teamId,
  membershipId,
  capabilityName,
  initial,
  canEdit,
}: Props) {
  const t = useTranslations('capabilities');
  const tErrors = useTranslations('capabilities.errors');
  const [granted, setGranted] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: boolean) {
    if (!canEdit) return;
    setError(null);
    const previous = granted;
    setGranted(next); // Optimistic
    startTransition(async () => {
      const result = await toggleCapability(
        teamId,
        membershipId,
        capabilityName,
        next
      );
      if (!result.success) {
        setGranted(previous); // Rollback
        setError(tErrors(result.error));
      }
    });
  }

  const id = `cap-${capabilityName}`;

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-md border border-border bg-card/40 px-4 py-3 transition',
        pending && 'opacity-70'
      )}
    >
      <div className="flex min-w-0 flex-col">
        <Label htmlFor={id} className="text-base">
          {t(`${capabilityName}.label`)}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t(`${capabilityName}.description`)}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Switch
        id={id}
        checked={granted}
        onCheckedChange={onChange}
        disabled={!canEdit || pending}
        aria-label={t(`${capabilityName}.label`)}
      />
    </div>
  );
}
