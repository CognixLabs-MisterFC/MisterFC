'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { updateStaffName, type UpdateStaffNameState } from '../actions';

type Props = {
  /** Profile del entrenador a editar (target de la función SECURITY DEFINER). */
  targetProfileId: string;
  currentName: string;
};

/**
 * Bug 2 · 2a — el admin corrige el nombre (global) de un entrenador. Espejo de
 * la edición de jugador, pero solo el campo nombre. Solo se renderiza para
 * admin_club y nunca para uno mismo (lo decide la page).
 */
export function EditStaffNameDialog({ targetProfileId, currentName }: Props) {
  const t = useTranslations('cuerpo_tecnico.edit_name');
  const [open, setOpen] = useState(false);

  const action = updateStaffName.bind(null, targetProfileId);
  const [state, formAction, pending] = useActionState<
    UpdateStaffNameState,
    FormData
  >(action, {});

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Pencil className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-name">{t('field.name')}</Label>
            <input
              id="staff-name"
              name="full_name"
              type="text"
              required
              maxLength={120}
              defaultValue={currentName}
              autoComplete="off"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
