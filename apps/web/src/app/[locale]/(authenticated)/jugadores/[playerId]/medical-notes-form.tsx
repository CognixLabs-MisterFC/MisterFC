'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  updateMedicalNotes,
  type MedicalNotesState,
} from '../actions';

type Props = {
  playerId: string;
  initial: string | null;
  canEdit: boolean;
};

export function MedicalNotesForm({ playerId, initial, canEdit }: Props) {
  const t = useTranslations('jugadores');
  const action = updateMedicalNotes.bind(null, playerId);
  const [state, formAction, pending] = useActionState<MedicalNotesState, FormData>(
    action,
    {}
  );

  const [lastHandled, setLastHandled] = useState(state);
  const [savedFlash, setSavedFlash] = useState(false);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setSavedFlash(true);
  }

  const errorMsg = state.error ? t(`medical.errors.${state.error}`) : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Label htmlFor="mn-text">{t('medical.label')}</Label>
      <textarea
        id="mn-text"
        name="medical_notes"
        maxLength={5000}
        rows={5}
        defaultValue={initial ?? ''}
        disabled={!canEdit}
        placeholder={t('medical.placeholder')}
        className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-misterfc-green disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{t('medical.help')}</p>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}
      {savedFlash && !state.error && (
        <p className="text-sm text-misterfc-green" role="status">
          {t('saved')}
        </p>
      )}

      {canEdit && (
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('actions.save')}</span>
          </Button>
        </div>
      )}
    </form>
  );
}
