'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { PLAYER_POSITIONS, PLAYER_FEET } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createPlayer, type PlayerFormState } from './actions';

type Props = {
  teams: Array<{ id: string; name: string }>;
};

export function CreatePlayerDialog({ teams }: Props) {
  const t = useTranslations('jugadores');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState<PlayerFormState, FormData>(
    createPlayer,
    {}
  );

  // Cierra dialog y redirige a la ficha del nuevo jugador al guardar OK.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success && state.playerId) {
      setOpen(false);
      router.push(`/jugadores/${state.playerId}`);
    }
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          <span>{t('create')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>{t('create_help')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-first-name">{t('field.first_name')}</Label>
              <Input
                id="cp-first-name"
                name="first_name"
                required
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-last-name">{t('field.last_name')}</Label>
              <Input
                id="cp-last-name"
                name="last_name"
                maxLength={120}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cp-dob">{t('field.date_of_birth')}</Label>
            <Input id="cp-dob" name="date_of_birth" type="date" required />
            <p className="text-xs text-muted-foreground">
              {t('field.date_of_birth_help')}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-dorsal">{t('field.dorsal')}</Label>
              <Input
                id="cp-dorsal"
                name="dorsal"
                type="number"
                min={1}
                max={99}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-position">{t('field.position_main')}</Label>
              <Select name="position_main">
                <SelectTrigger id="cp-position">
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
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-foot">{t('field.foot')}</Label>
              <Select name="foot">
                <SelectTrigger id="cp-foot">
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
            {teams.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cp-team">{t('field.team')}</Label>
                <Select name="team_id">
                  <SelectTrigger id="cp-team">
                    <SelectValue placeholder={t('field.no_team')} />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('actions.create')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
