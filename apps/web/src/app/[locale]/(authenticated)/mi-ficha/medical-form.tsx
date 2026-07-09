'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { upsertPlayerMedical, type MedicalFormState } from './medical-actions';

type Initial = {
  allergies: string | null;
  medication: string | null;
  medical_conditions: string | null;
  emergency_contact: string | null;
};

/**
 * F14-4 — Formulario del TUTOR para gestionar los 4 campos médicos de su hijo de
 * forma continua. La escritura la gobierna la RLS (tutor + consentimiento).
 */
export function MedicalForm({ playerId, initial }: { playerId: string; initial: Initial | null }) {
  const t = useTranslations('mi_ficha');
  const action = upsertPlayerMedical.bind(null, playerId);
  const [state, formAction, pending] = useActionState<MedicalFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field name="allergies" label={t('medical.allergies')} initial={initial?.allergies} />
      <Field name="medication" label={t('medical.medication')} initial={initial?.medication} />
      <Field
        name="medical_conditions"
        label={t('medical.conditions')}
        initial={initial?.medical_conditions}
      />
      <Field
        name="emergency_contact"
        label={t('medical.emergency')}
        initial={initial?.emergency_contact}
      />

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`medical.errors.${state.error}`)}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-misterfc-green" role="status">
          {t('medical.saved')}
        </p>
      )}

      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{t('medical.save')}</span>
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  initial,
}: {
  name: string;
  label: string;
  initial: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`med-${name}`}>{label}</Label>
      <textarea
        id={`med-${name}`}
        name={name}
        rows={2}
        maxLength={2000}
        defaultValue={initial ?? ''}
        className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-misterfc-green"
      />
    </div>
  );
}
