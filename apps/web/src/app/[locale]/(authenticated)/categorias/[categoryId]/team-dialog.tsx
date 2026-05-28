'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { TEAM_FORMATS } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import {
  createTeam,
  updateTeam,
  type TeamFormState,
} from './actions';

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  categoryId: string;
  team?: {
    id: string;
    name: string;
    format: (typeof TEAM_FORMATS)[number];
    color: string;
  };
};

const DEFAULT_COLOR = '#10B981';

export function TeamDialog({ mode, categoryId, team }: Props) {
  const t = useTranslations('equipos');
  const [open, setOpen] = useState(false);

  const action =
    mode === 'edit' && team
      ? updateTeam.bind(null, team.id)
      : createTeam.bind(null, categoryId);

  const [state, formAction, pending] = useActionState<TeamFormState, FormData>(
    action,
    {}
  );

  // Cierra el dialog al guardar OK. Render-time guard (React 19 prohíbe
  // setState dentro de useEffect; ver category-dialog.tsx para el mismo patrón).
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) setOpen(false);
  }

  const isEdit = mode === 'edit';
  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label={t('actions.edit')}>
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button>
            <Plus className="size-4" aria-hidden />
            <span>{t('actions.create')}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('dialog.edit_title') : t('dialog.create_title')}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('field.name')}</Label>
            <Input
              id="team-name"
              name="name"
              required
              maxLength={80}
              defaultValue={team?.name ?? ''}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="team-format">{t('field.format')}</Label>
            <Select name="format" defaultValue={team?.format ?? 'F7'}>
              <SelectTrigger id="team-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="team-color">{t('field.color')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="team-color"
                name="color"
                type="color"
                className="h-10 w-16 p-1"
                defaultValue={team?.color ?? DEFAULT_COLOR}
              />
              <p className="text-xs text-muted-foreground">
                {t('field.color_help')}
              </p>
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
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('actions.save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
