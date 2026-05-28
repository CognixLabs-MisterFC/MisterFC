'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Plus } from 'lucide-react';
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
  createCategory,
  updateCategory,
  type CategoryFormState,
} from './actions';

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  defaultSeason: string;
  category?: {
    id: string;
    name: string;
    season: string;
    order_idx: number;
  };
};

export function CategoryDialog({ mode, defaultSeason, category }: Props) {
  const t = useTranslations('categorias');
  const [open, setOpen] = useState(false);

  const action =
    mode === 'edit' && category
      ? updateCategory.bind(null, category.id)
      : createCategory;

  const [state, formAction, pending] = useActionState<
    CategoryFormState,
    FormData
  >(action, {});

  // Cierra el dialog al guardar OK. Se hace en render con guard de identidad
  // para no caer en setState-in-effect (React 19) y evitar cascadas.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;
  const isEdit = mode === 'edit';

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
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cat-name">{t('field.name')}</Label>
            <Input
              id="cat-name"
              name="name"
              required
              maxLength={80}
              defaultValue={category?.name ?? ''}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cat-season">{t('field.season')}</Label>
            <Input
              id="cat-season"
              name="season"
              required
              placeholder="2025-26"
              pattern="[0-9]{4}-[0-9]{2}"
              defaultValue={category?.season ?? defaultSeason}
            />
            <p className="text-xs text-muted-foreground">{t('field.season_help')}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cat-order">{t('field.order_idx')}</Label>
            <Input
              id="cat-order"
              name="order_idx"
              type="number"
              min={0}
              max={9999}
              defaultValue={category?.order_idx ?? 0}
            />
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
