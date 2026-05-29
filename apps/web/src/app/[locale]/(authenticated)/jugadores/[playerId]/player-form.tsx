'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { PLAYER_POSITIONS, PLAYER_FEET } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updatePlayer, type PlayerFormState } from '../actions';

type PlayerInitial = {
  first_name: string;
  /** Nullable per F2.9 hotfix 2026-05-30. */
  last_name: string | null;
  date_of_birth: string;
  dorsal: number | null;
  position_main: string | null;
  positions_secondary: string[];
  foot: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  origin: string | null;
};

type Props = {
  playerId: string;
  initial: PlayerInitial;
  canEdit: boolean;
};

export function PlayerForm({ playerId, initial, canEdit }: Props) {
  const t = useTranslations('jugadores');
  const action = updatePlayer.bind(null, playerId);
  const [state, formAction, pending] = useActionState<PlayerFormState, FormData>(
    action,
    {}
  );

  // Notificación inline al guardar OK (no cierra nada — el form se queda).
  const [lastHandled, setLastHandled] = useState(state);
  const [savedFlash, setSavedFlash] = useState(false);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setSavedFlash(true);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  const fieldProps = canEdit ? {} : { disabled: true };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-first-name">{t('field.first_name')}</Label>
          <Input
            id="pf-first-name"
            name="first_name"
            required
            maxLength={80}
            defaultValue={initial.first_name}
            {...fieldProps}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-last-name">{t('field.last_name')}</Label>
          <Input
            id="pf-last-name"
            name="last_name"
            maxLength={120}
            defaultValue={initial.last_name ?? ''}
            {...fieldProps}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-dob">{t('field.date_of_birth')}</Label>
          <Input
            id="pf-dob"
            name="date_of_birth"
            type="date"
            required
            defaultValue={initial.date_of_birth}
            {...fieldProps}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-dorsal">{t('field.dorsal')}</Label>
          <Input
            id="pf-dorsal"
            name="dorsal"
            type="number"
            min={1}
            max={99}
            defaultValue={initial.dorsal ?? ''}
            {...fieldProps}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-position">{t('field.position_main')}</Label>
          <Select
            name="position_main"
            defaultValue={initial.position_main ?? undefined}
            disabled={!canEdit}
          >
            <SelectTrigger id="pf-position">
              <SelectValue placeholder={t('field.optional')} />
            </SelectTrigger>
            <SelectContent>
              {PLAYER_POSITIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`positions.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-foot">{t('field.foot')}</Label>
          <Select
            name="foot"
            defaultValue={initial.foot ?? undefined}
            disabled={!canEdit}
          >
            <SelectTrigger id="pf-foot">
              <SelectValue placeholder={t('field.optional')} />
            </SelectTrigger>
            <SelectContent>
              {PLAYER_FEET.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`feet.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-origin">{t('field.origin')}</Label>
          <Input
            id="pf-origin"
            name="origin"
            maxLength={120}
            defaultValue={initial.origin ?? ''}
            {...fieldProps}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-height">{t('field.height_cm')}</Label>
          <Input
            id="pf-height"
            name="height_cm"
            type="number"
            min={50}
            max={250}
            defaultValue={initial.height_cm ?? ''}
            {...fieldProps}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pf-weight">{t('field.weight_kg')}</Label>
          <Input
            id="pf-weight"
            name="weight_kg"
            type="number"
            step="0.1"
            min={10}
            max={200}
            defaultValue={initial.weight_kg ?? ''}
            {...fieldProps}
          />
        </div>
      </div>

      {/* Secondary positions como N inputs checkbox */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">
          {t('field.positions_secondary')}
        </legend>
        <div className="flex flex-wrap gap-3">
          {PLAYER_POSITIONS.map((p) => (
            <label
              key={p}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <input
                type="checkbox"
                name="positions_secondary"
                value={p}
                defaultChecked={initial.positions_secondary.includes(p)}
                disabled={!canEdit}
                className="size-4 rounded border-zinc-700 bg-zinc-900"
              />
              <span>{t(`positions.${p}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

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
