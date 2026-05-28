'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { PLAYER_POSITIONS } from '@misterfc/core';
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
import { assignPlayerToTeam, type AssignToTeamState } from '../actions';

type Props = {
  playerId: string;
  teams: Array<{ id: string; name: string }>;
  hasActiveAssignment: boolean;
};

export function AssignTeamDialog({
  playerId,
  teams,
  hasActiveAssignment,
}: Props) {
  const t = useTranslations('jugadores.assign');
  const tPositions = useTranslations('jugadores.positions');
  const [open, setOpen] = useState(false);

  const action = assignPlayerToTeam.bind(null, playerId);
  const [state, formAction, pending] = useActionState<AssignToTeamState, FormData>(
    action,
    {}
  );

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeft className="size-4" aria-hidden />
          <span>{hasActiveAssignment ? t('action_move') : t('action_assign')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasActiveAssignment ? t('title_move') : t('title_assign')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="at-team">{t('field.team')}</Label>
            <Select name="team_id" required>
              <SelectTrigger id="at-team">
                <SelectValue placeholder={t('field.team_placeholder')} />
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

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="at-dorsal">{t('field.dorsal_in_team')}</Label>
              <Input
                id="at-dorsal"
                name="dorsal_in_team"
                type="number"
                min={1}
                max={99}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="at-position">{t('field.position_in_team')}</Label>
              <Select name="position_in_team">
                <SelectTrigger id="at-position">
                  <SelectValue placeholder={t('field.optional')} />
                </SelectTrigger>
                <SelectContent>
                  {PLAYER_POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tPositions(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
