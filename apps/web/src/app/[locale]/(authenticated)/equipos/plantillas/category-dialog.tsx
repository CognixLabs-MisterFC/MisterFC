'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil } from 'lucide-react';
import { CATEGORY_KINDS } from '@misterfc/core';
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
import {
  updateCategoryTemplate,
  type CategoryTemplateFormState,
} from './actions';

const NO_KIND = '__none__';

type Props = {
  isStandard?: boolean;
  category: {
    id: string;
    name: string;
    kind: string | null;
    half_duration_minutes: number;
  };
};

/**
 * Diálogo de EDICIÓN de categoría-plantilla. Rework C · C4: el alta de categorías
 * se retiró (el club solo crea equipos); el catálogo es fijo. En una estándar,
 * name + kind están bloqueados (solo half_duration); el servidor lo garantiza.
 */
export function CategoryDialog({ isStandard = false, category }: Props) {
  const t = useTranslations('plantillas');
  const tk = useTranslations('category_kinds');
  const [open, setOpen] = useState(false);
  const locked = isStandard;

  const [kind, setKind] = useState(category.kind ?? NO_KIND);

  const action = updateCategoryTemplate.bind(null, category.id);

  const [state, formAction, pending] = useActionState<
    CategoryTemplateFormState,
    FormData
  >(action, {});

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('actions.edit')}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialog.edit_title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {locked && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('standard_locked_hint')}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="cat-name">{t('field.name')}</Label>
            <Input
              id="cat-name"
              name="name"
              required
              maxLength={80}
              defaultValue={category.name}
              autoFocus={!locked}
              readOnly={locked}
              aria-readonly={locked}
              className={locked ? 'cursor-not-allowed opacity-70' : undefined}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cat-kind">{t('field.kind')}</Label>
            <input
              type="hidden"
              name="kind"
              value={kind === NO_KIND ? '' : kind}
            />
            <Select value={kind} onValueChange={setKind} disabled={locked}>
              <SelectTrigger id="cat-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_KIND}>{t('kind_none')}</SelectItem>
                {CATEGORY_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {tk(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('field.kind_help')}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cat-half">{t('field.half_duration')}</Label>
            <Input
              id="cat-half"
              name="half_duration_minutes"
              type="number"
              min={1}
              max={90}
              required
              defaultValue={category.half_duration_minutes}
            />
            <p className="text-xs text-muted-foreground">
              {t('field.half_duration_help')}
            </p>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('actions.save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
